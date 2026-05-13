const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT   = process.env.PORT || 3000;

// ── SUPABASE ──────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── CORS ──────────────────────────────────────────────────────────
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Later Letters backend is running 💙' });
});

// ── RECEIVE EMAIL FROM MAILGUN ────────────────────────────────────
app.post('/inbound', upload.any(), async (req, res) => {
  try {
    const body      = req.body;
    const recipient = (body.recipient || body.To || '').split('@')[0].toLowerCase().trim();
    const subject   = body.subject || body.Subject || 'A memory for you';
    const text      = body['body-plain'] || body['stripped-text'] || body.text || '';

    console.log(`Email received for slug: ${recipient}`);

    const { data: person, error: personError } = await supabase
      .from('people')
      .select('user_id, name')
      .eq('email_slug', recipient)
      .single();

    if (personError || !person) {
      console.log(`No person found for: ${recipient}`);
      return res.status(200).json({ message: 'No matching person' });
    }

    const { error: insertError } = await supabase
      .from('letters')
      .insert({
        user_id: person.user_id, recipient: person.name,
        title: subject, body: text.trim(),
        category: 'letter', emoji: '💌',
        photos: [], audio_recs: [], video_recs: [],
        locked: false, pin: '', timed: false, open_date: null
      });

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(200).json({ error: insertError.message });
    }

    console.log(`Letter saved for ${person.name}`);
    res.status(200).json({ message: 'Letter saved' });
  } catch (err) {
    console.error('Error:', err);
    res.status(200).json({ error: err.message });
  }
});

// ── GET LETTERS ───────────────────────────────────────────────────
app.get('/letters', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  const { data, error: dbError } = await supabase
    .from('letters').select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ letters: data });
});

// ── SAVE LETTER ───────────────────────────────────────────────────
app.post('/letters', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  const { data, error: dbError } = await supabase
    .from('letters')
    .insert({
      user_id:    user.id,
      recipient:  req.body.recipient || 'My loved one',
      title:      req.body.title,
      body:       req.body.body || '',
      category:   req.body.category || 'letter',
      emoji:      req.body.emoji || '',
      photos:     req.body.photos || [],
      audio_recs: req.body.audioRecs || [],
      video_recs: req.body.videoRecs || [],
      locked:     req.body.locked || false,
      pin:        req.body.pin || '',
      timed:      req.body.timed || false,
      open_date:  req.body.openDate || null
    })
    .select().single();
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ letter: data });
});

// ── DELETE LETTER ─────────────────────────────────────────────────
app.delete('/letters/:id', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  const { error: dbError } = await supabase
    .from('letters').delete()
    .eq('id', req.params.id).eq('user_id', user.id);
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ message: 'Deleted' });
});

// ── GET PEOPLE ────────────────────────────────────────────────────
app.get('/people', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  const { data, error: dbError } = await supabase
    .from('people').select('*').eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ people: data });
});

// ── ADD PERSON ────────────────────────────────────────────────────
app.post('/people', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { data, error: dbError } = await supabase
    .from('people')
    .insert({ user_id: user.id, name, email_slug: slug })
    .select().single();
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ person: data });
});

// ── DELETE PERSON ─────────────────────────────────────────────────
app.delete('/people/:id', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  const { error: dbError } = await supabase
    .from('people').delete()
    .eq('id', req.params.id).eq('user_id', user.id);
  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ message: 'Deleted' });
});

// ── START ─────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Later Letters running on port ${PORT} 💙`));
