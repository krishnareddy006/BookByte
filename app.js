// ------------ BookByte main server -----------------
import express from 'express';
import path     from 'path';
import { fileURLToPath } from 'url';
import dotenv   from 'dotenv';
import pg       from 'pg';
import axios    from 'axios';

dotenv.config();
const { PORT, PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;

const pool = new pg.Pool({ host: PGHOST, port: PGPORT, database: PGDATABASE,
                           user: PGUSER, password: PGPASSWORD });

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
app.set('view engine', 'ejs');

// --------- helpers -------------------------------------------------------
async function fetchBookMeta(isbn) {
  // Open Library Books API → /isbn/{isbn}.json
  const url = `https://openlibrary.org/isbn/${isbn}.json`;
  const { data } = await axios.get(url);
  return {
    title : data.title,
    author: (data.authors && data.authors[0])
              ? (await axios.get(`https://openlibrary.org${data.authors[0].key}.json`)).data.name
              : 'Unknown',
    olid   : data.key?.split('/').pop(),
    cover  : data.covers ? data.covers[0] : null
  };
}

// --------- routes --------------------------------------------------------
// HOME list -- supports search & sort
app.get('/', async (req, res) => {
  const { title, sort } = req.query;
  let sql = 'SELECT * FROM books';
  const params = [];
  if (title) { params.push(`%${title}%`); sql += ` WHERE title ILIKE $${params.length}`; }
  if (sort === 'alpha')   sql += ' ORDER BY title';
  if (sort === 'rating')  sql += ' ORDER BY rating DESC';
  if (sort === 'recent')  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);
  res.render('index', { books: rows, query: title, sort });
});

// CREATE form
app.get('/create', (req, res) => res.render('create', { book: null }));

// INSERT new
app.post('/create', async (req, res) => {
  try {
    const { isbn, rating, review, read_date } = req.body;
    const meta = await fetchBookMeta(isbn);
    await pool.query(
      `INSERT INTO books (title,author,isbn,olid,cover_id,rating,review,read_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [meta.title, meta.author, isbn, meta.olid, meta.cover, rating, review, read_date || null]
    );
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Error adding book - ' + err.message);
  }
});

// VIEW one
app.get('/book/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Not found');
  res.render('view', { book: rows[0] });
});

// EDIT form
app.get('/edit/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Not found');
  res.render('create', { book: rows[0] });
});

// UPDATE
app.post('/edit/:id', async (req, res) => {
  const { isbn, rating, review, read_date } = req.body;
  // optionally refetch meta when ISBN changes
  const meta = await fetchBookMeta(isbn);
  await pool.query(
    `UPDATE books SET title=$1,author=$2,isbn=$3,olid=$4,cover_id=$5,
                      rating=$6,review=$7,read_date=$8 WHERE id=$9`,
    [meta.title, meta.author, isbn, meta.olid, meta.cover,
     rating, review, read_date || null, req.params.id]
  );
  res.redirect('/book/' + req.params.id);
});

// DELETE
app.post('/delete/:id',async (req, res) =>{
  await pool.query('DELETE FROM books WHERE id=$1', [req.params.id]);
  res.redirect('/')
});

// ------------- start -----------------------------------------------------
app.listen(PORT || 3000, () => console.log(`BookByte running on http://localhost:${PORT}`));
