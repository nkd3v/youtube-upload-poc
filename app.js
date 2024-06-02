require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { google } = require('googleapis');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('base64');

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'http://localhost:3000/auth/google/callback'
);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(cookieParser());
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: true }));
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());

function isAuthenticated(req, res, next) {
  if (req.session.tokens) {
    next();
  } else {
    res.redirect('/');
  }
}

async function checkYouTubeChannel(auth) {
  try {
    const youtube = google.youtube({ version: 'v3', auth });
    const response = await youtube.channels.list({
      part: 'id',
      mine: true,
    });

    return response.data.items.length > 0;
  } catch (error) {
    console.error('Error checking YouTube channel:', error);
    return false;
  }
}

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

app.get('/profile', isAuthenticated, async (req, res) => {
  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: 'v2'
  });

  oauth2Client.setCredentials(req.session.tokens);
  const userInfo = await oauth2.userinfo.get();
  req.session.user = userInfo.data;

  res.render('profile', { user: req.session.user });
});

app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile', 
      'https://www.googleapis.com/auth/userinfo.email', 
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    prompt: 'select_account'
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  req.session.tokens = tokens;
  res.send(`
    <script>
      window.opener.postMessage('authenticated', '*');
      window.close();
    </script>
  `);
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/upload', isAuthenticated, async (req, res) => {
  oauth2Client.setCredentials(req.session.tokens);

  const hasChannel = await checkYouTubeChannel(oauth2Client);
  if (!hasChannel) {
    return res.render('no-channel', { user: req.session.user });
  }

  res.render('upload', { user: req.session.user });
});

app.post('/upload', isAuthenticated, async (req, res) => {
  try {
    oauth2Client.setCredentials(req.session.tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const file = req.files.video;
    const filePath = `${process.env.UPLOAD_PATH}/${file.name}`;

    file.mv(filePath, async (err) => {
      if (err) {
        return res.status(500).send(err);
      }

      const response = await youtube.videos.insert({
        part: 'id,snippet,status',
        requestBody: {
          snippet: {
            title: req.body.title,
            description: req.body.description
          },
          status: {
            privacyStatus: 'private'
          }
        },
        media: {
          body: fs.createReadStream(filePath)
        }
      });

      res.render('upload-success', { videoId: response.data.id });
    });
  } catch (error) {
    console.error('Error uploading video: ', error);
    res.status(500).send('Error uploading video');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});