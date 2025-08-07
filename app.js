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
                           user: PGUSER, password: PGPASSWORD,  ssl: {
    rejectUnauthorized: false
  } });

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
app.set('view engine', 'ejs');


const createTableQuery = `
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT,
  olid TEXT,
  cover_id INTEGER,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  read_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

// Seed data (only inserts if no rows exist)
const seedBooksQuery = `
INSERT INTO books (title, author, isbn, olid, cover_id, rating, review, read_date)
SELECT * FROM (
  VALUES
    ('Atomic Habits', 'James Clear', '0735211299', 'OL32336498M', 2407271, 5, 'Life‑changing book on habit formation.', '2025-07-10'),
    ('1984', 'George Orwell', '0451524934', 'OL7349875M', 1533135, 4, 'Dystopian classic about government control.', '2025-06-01'),
    ('The Great Gatsby', 'F. Scott Fitzgerald', '0743273567', 'OL26442009M', 295548, 5, 'Portrait of the American dream gone awry.', '2025-05-15'),
    ('To Kill a Mockingbird', 'Harper Lee', '9780061120084', 'OL26016558M', 8226191, 5, 'Timeless novel about justice and morality.', '2025-04-20'),
    ('Sapiens: A Brief History of Humankind', 'Yuval Noah Harari', '0062316095', 'OL24254688M', 9254196, 5, 'Sweeping overview of human history.', '2025-03-10'),
    ('The Hobbit', 'J.R.R. Tolkien', '054792822X', 'OL26331930M', 6979861, 4, 'A classic fantasy journey.', '2025-02-05'),
    ('Pride and Prejudice', 'Jane Austen', '0679783261', 'OL26331944M', 2558301, 4, 'A witty exploration of manners and marriage.', '2025-01-22'),
    ('The Catcher in the Rye', 'J.D. Salinger', '0316769487', 'OL24324827M', 8231850, 3, 'A teenage outsider’s voice.', '2024-12-10'),
    ('Brave New World', 'Aldous Huxley', '0060850523', 'OL24388482M', 1534265, 4, 'Futuristic social satire.', '2024-11-15'),
    ('Moby‑Dick', 'Herman Melville', '1503280780', 'OL24352609M', 1533135, 3, 'Epic tale of obsession and the sea.', '2024-10-01'),
    ('Fahrenheit 451', 'Ray Bradbury', '1451673310', 'OL25432858M', 1536303, 4, 'Dystopian novel about book burning.', '2024-09-05'),
    ('The Alchemist', 'Paulo Coelho', '0061122416', 'OL31861655M', 3110075, 5, 'A philosophical journey to follow your dream.', '2024-08-20')
) AS t(title, author, isbn, olid, cover_id, rating, review, read_date)
WHERE NOT EXISTS (SELECT 1 FROM books);
`;

// Run DB setup
const setupDatabase = async () => {
  try {
    await pool.query(createTableQuery);
    console.log('✅ Table "books" ensured');
    await pool.query(seedBooksQuery);
    console.log('✅ Sample book data seeded if table was empty');
  } catch (err) {
    console.error('❌ Error setting up database:', err);
  }
};

setupDatabase();

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
