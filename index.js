require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const path = require('path');
const fs = require('fs').promises;
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const process = require('process');
const port  = process.env.PORT || 3000

const app = express();
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));

const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

// Create OAuth2 client instance
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Login Route
app.get('/', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

// OAuth2 callback
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await saveCredentials(oauth2Client);

    res.cookie('token', tokens.access_token);
    res.redirect('/connections');
  } catch (error) {
    res.status(500).send('Authentication failed');
  }
});

// Route to list connections with phone numbers
/*
app.get('/connections', async (req, res) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).send('No access token found. Please login again.');
  }

  oauth2Client.setCredentials({ access_token: token });

  try {
    const service = google.people({ version: 'v1', auth: oauth2Client });
    const response = await service.people.connections.list({
      resourceName: 'people/me',
      pageSize: 100, // Adjust the pageSize as needed
      personFields: 'names,emailAddresses,phoneNumbers',
    });

    const connections = response.data.connections;
    if (!connections || connections.length === 0) {
      res.send('No connections found.');
      return;
    }

    res.json(connections.map(person => ({
      name: person.names ? person.names[0].displayName : 'No display name',
      phoneNumbers: person.phoneNumbers ? person.phoneNumbers.map(phone => phone.value) : 'No phone numbers'
    })));
  } catch (error) {
    console.error('Error fetching connections:', error.response ? error.response.data : error.message);
    res.status(500).send('Error fetching connections');
  }
});
*/
// Route to list all connections with phone numbers
app.get('/connections', async (req, res) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).send('No access token found. Please login again.');
  }

  oauth2Client.setCredentials({ access_token: token });

  try {
    const service = google.people({ version: 'v1', auth: oauth2Client });
    let connections = [];
    let nextPageToken = null;

    do {
      const response = await service.people.connections.list({
        resourceName: 'people/me',
        pageSize: 100, // You can adjust this number to retrieve more or fewer results per page
        personFields: 'names,emailAddresses,phoneNumbers',
        pageToken: nextPageToken,
      });

      // Append connections from the current page
      connections = connections.concat(response.data.connections || []);
      
      // Update the token for the next page
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken); // Continue until no more pages

    if (connections.length === 0) {
      res.send('No connections found.');
      return;
    }

    res.json(connections.map(person => ({
      name: person.names ? person.names[0].displayName : 'No display name',
      phoneNumbers: person.phoneNumbers ? person.phoneNumbers.map(phone => phone.value) : 'No phone numbers'
    })));
  } catch (error) {
    console.error('Error fetching connections:', error.response ? error.response.data : error.message);
    res.status(500).send('Error fetching connections');
  }
});

// Start the server
app.listen(port, () => {
  console.log('Server is running on http://localhost:3000');
});
