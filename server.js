const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Discord OAuth2 Credentials (Replace DISCORD_CLIENT_SECRET if you reset it in Dev Portal)
const DISCORD_CLIENT_ID = '1566401329134436445';
const DISCORD_CLIENT_SECRET = 'JJHICceMcJL49pWQtxDhbvNkRcI23jdq';
const CALLBACK_URL = 'http://localhost:3000/auth/discord/callback';

// Admin Discord ID Whitelist
const ADMIN_DISCORD_ID = '1287363175158644757';

// File Paths & Storage
const UPLOADS_DIR = path.join(__dirname, 'public/uploads');
const CACHE_FILE = path.join(__dirname, 'cloud_cache.json');
const USERS_FILE = path.join(__dirname, 'users_cache.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify([]));
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));

// Express Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'theroplayer-uncopylocked-secret-key-2026',
    resave: false,
    saveUninitialized: false
}));

// Passport Setup (Logging Removed for Privacy & Clean Output)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    let users = getUsersCache();
    
    // Fallback CDN image for accounts with null/custom avatars
    const userAvatar = profile.avatar 
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

    if (!users[profile.id]) {
        users[profile.id] = {
            id: profile.id,
            username: profile.username,
            avatar: userAvatar,
            bio: 'Roblox developer & creator on TheRoPlayer Tools.',
            followers: [],
            following: [],
            verified: false,
            banned: false
        };
    } else {
        users[profile.id].username = profile.username;
        users[profile.id].avatar = userAvatar;
    }

    if (users[profile.id].followers && users[profile.id].followers.length >= 1000) {
        users[profile.id].verified = true;
    }

    saveUsersCache(users);
    return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// Ban Check Middleware (Intercepts banned users cleanly)
app.use((req, res, next) => {
    if (req.path === '/banned.html' || req.path.startsWith('/uploads/') || req.path.startsWith('/auth/')) {
        return next();
    }
    if (req.isAuthenticated()) {
        const users = getUsersCache();
        const user = users[req.user.id];
        if (user && user.banned) {
            return res.redirect('/banned.html');
        }
    }
    next();
});

// Multer Storage Engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Safe JSON Helper Functions
function getCloudCache() {
    try {
        const data = fs.readFileSync(CACHE_FILE, 'utf8');
        return data.trim() ? JSON.parse(data) : [];
    } catch { return []; }
}
function saveCloudCache(data) { fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2)); }

function getUsersCache() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return data.trim() ? JSON.parse(data) : {};
    } catch { return {}; }
}
function saveUsersCache(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }

/* --- AUTHENTICATION ROUTES --- */
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
});

app.get('/api/me', (req, res) => {
    if (req.isAuthenticated()) {
        const users = getUsersCache();
        const user = users[req.user.id] || req.user;
        if (user.banned) return res.json({ authenticated: false });
        if (user.followers && user.followers.length >= 1000) user.verified = true;
        res.json({ authenticated: true, user });
    } else {
        res.json({ authenticated: false });
    }
});

app.get('/logout', (req, res) => {
    req.logout(() => { res.redirect('/'); });
});

/* --- UPLOAD & POST ROUTES --- */
app.post('/api/upload', upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'assetFile', maxCount: 1 }
]), (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

    const { title, description, assetType, youtubeUrl, timerDuration } = req.body;
    let parsedTimer = parseInt(timerDuration, 10) || 0;
    if (parsedTimer > 120) parsedTimer = 120;

    const imageFile = req.files['image'] ? '/uploads/' + req.files['image'][0].filename : 'https://via.placeholder.com/600x400/1e293b/38bdf8?text=No+Image';
    const assetFile = req.files['assetFile'] ? '/uploads/' + req.files['assetFile'][0].filename : null;

    if (!title || !description || !assetFile) return res.status(400).json({ error: 'Missing required fields.' });

    const newTool = {
        id: Date.now().toString(),
        title,
        description,
        assetType,
        image: imageFile,
        downloadFile: assetFile,
        youtubeUrl: youtubeUrl || null,
        timerDuration: parsedTimer,
        authorId: req.user.id,
        author: {
            id: req.user.id,
            username: req.user.username,
            avatar: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'
        },
        likes: [],
        comments: [],
        isTrending: false,
        createdAt: new Date().toISOString()
    };

    const cache = getCloudCache();
    cache.unshift(newTool);
    saveCloudCache(cache);
    res.json({ success: true, downloadUrl: `/generateddown.html?id=${newTool.id}` });
});

app.get('/api/tools', (req, res) => res.json(getCloudCache()));

app.get('/api/tools/:id', (req, res) => {
    const cache = getCloudCache();
    const item = cache.find(t => t.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
});

// Likes
app.post('/api/tools/:id/like', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    const cache = getCloudCache();
    const item = cache.find(t => t.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Tool not found' });

    if (!item.likes) item.likes = [];
    const index = item.likes.indexOf(req.user.id);
    if (index > -1) {
        item.likes.splice(index, 1);
    } else {
        item.likes.push(req.user.id);
    }
    saveCloudCache(cache);
    res.json({ success: true, likes: item.likes });
});

// Comments
app.post('/api/tools/:id/comment', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

    const cache = getCloudCache();
    const item = cache.find(t => t.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Tool not found' });

    if (!item.comments) item.comments = [];
    const newComment = {
        id: Date.now().toString(),
        userId: req.user.id,
        username: req.user.username,
        avatar: req.user.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
        text: text.trim(),
        createdAt: new Date().toISOString()
    };
    item.comments.push(newComment);
    saveCloudCache(cache);
    res.json({ success: true, comments: item.comments });
});

/* --- USER PROFILE & SETTINGS ROUTES --- */
app.get('/api/users/:id', (req, res) => {
    const users = getUsersCache();
    const user = users[req.params.id];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.followers && user.followers.length >= 1000) {
        user.verified = true;
    }

    const cache = getCloudCache();
    const userPosts = cache.filter(t => t.authorId === req.params.id);
    res.json({ user, posts: userPosts });
});

app.post('/api/user/bio', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    const { bio } = req.body;
    
    let users = getUsersCache();
    if (users[req.user.id]) {
        users[req.user.id].bio = bio ? bio.trim() : '';
        saveUsersCache(users);
        res.json({ success: true, bio: users[req.user.id].bio });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.post('/api/users/:id/follow', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    const targetId = req.params.id;
    const currentId = req.user.id;
    if (targetId === currentId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const users = getUsersCache();
    if (!users[targetId] || !users[currentId]) return res.status(404).json({ error: 'User not found' });

    const targetUser = users[targetId];
    const currentUser = users[currentId];

    if (!targetUser.followers) targetUser.followers = [];
    if (!currentUser.following) currentUser.following = [];

    const isFollowing = targetUser.followers.includes(currentId);
    if (isFollowing) {
        targetUser.followers = targetUser.followers.filter(id => id !== currentId);
        currentUser.following = currentUser.following.filter(id => id !== targetId);
    } else {
        targetUser.followers.push(currentId);
        currentUser.following.push(targetId);
    }

    if (targetUser.followers.length >= 1000) {
        targetUser.verified = true;
    }

    saveUsersCache(users);
    res.json({ success: true, followersCount: targetUser.followers.length, isFollowing: !isFollowing });
});

// Edit Post
app.post('/api/posts/:id/edit', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    const { title, description } = req.body;
    
    const cache = getCloudCache();
    const post = cache.find(t => t.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    if (post.authorId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    if (title) post.title = title.trim();
    if (description) post.description = description.trim();

    saveCloudCache(cache);
    res.json({ success: true, post });
});

// Delete Post
app.delete('/api/posts/:id', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    
    let cache = getCloudCache();
    const post = cache.find(t => t.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    if (post.authorId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    if (post.downloadFile) {
        const filePath = path.join(__dirname, 'public', post.downloadFile);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    cache = cache.filter(t => t.id !== req.params.id);
    saveCloudCache(cache);
    res.json({ success: true });
});

/* --- ADMIN ROUTES --- */
app.get('/api/admin/check', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ admin: false });
    }
    res.json({ admin: true });
});

app.get('/api/admin/users', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json(getUsersCache());
});

app.post('/api/admin/verify/:userId', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const users = getUsersCache();
    const target = users[req.params.userId];
    if (!target) return res.status(404).json({ error: 'User not found' });

    target.verified = !target.verified;
    saveUsersCache(users);
    res.json({ success: true, verified: target.verified });
});

app.post('/api/admin/users/:id/ban', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const users = getUsersCache();
    const target = users[req.params.id];
    if (!target) return res.status(404).json({ error: 'User not found' });

    target.banned = !target.banned;
    saveUsersCache(users);
    res.json({ success: true, banned: target.banned });
});

app.post('/api/admin/posts/:id/trending', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const cache = getCloudCache();
    const post = cache.find(t => t.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    post.isTrending = !post.isTrending;
    saveCloudCache(cache);
    res.json({ success: true, isTrending: post.isTrending });
});

app.delete('/api/admin/posts/:id', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    let cache = getCloudCache();
    const post = cache.find(t => t.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.downloadFile) {
        const filePath = path.join(__dirname, 'public', post.downloadFile);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    cache = cache.filter(t => t.id !== req.params.id);
    saveCloudCache(cache);
    res.json({ success: true });
});

// Stream Download
app.get('/api/download/stream/:id', (req, res) => {
    const cache = getCloudCache();
    const item = cache.find(t => t.id === req.params.id);
    if (!item || !item.downloadFile) return res.status(404).send('File not found');
    const filePath = path.join(__dirname, 'public', item.downloadFile);
    res.download(filePath);
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on http://localhost:${PORT}`);
});