const express = require('express')
const redis = require('redis')
const bcrypt = require('bcrypt')
const session = require('express-session')
const path = require('path')

require('dotenv').config();
let secret = process.env.SESSION_SECRET

const app = express()
const RedisStore = require('connect-redis')(session)
const client = redis.createClient()
const port = process.env.port || 3000

client.on('connect', () => {
	console.log('Connected to Redis...')
})

// set up pug
app.set('view engine', 'pug')
app.set('views', path.join(__dirname, 'views'))

// middleware
app.use(express.urlencoded({ extended: true }))
app.use(
	session({
		store: new RedisStore({ client: client }),
		resave: true,
		saveUninitialized: true,
		cookie: {
			maxAge: 60000, //1 minute, in milliseconds
			httpOnly: false,
			secure: false,
		},
		secret: secret,
	})
);

app.get('/', (req, res) => {
	console.log(`req.session from app.get: ${req.session.userId}`)
	if(req.session.userId) {
		client.hget(`user:${req.session.userId}`, 'username', (err, currentUserName) => {
			client.smembers(`following:${currentUserName}`, (err, following) => {
				// console.log(`following: ${currentUserName}`)
				client.hkeys('users', (err, users) => {
					// console.log(`users: ${users}`)
					res.render('dashboard', {
						users: users.filter((user) => user !== currentUserName && following.indexOf(user) === -1)
					})
				})
			})
		})
	} else {
		res.render('login')
	}
})

// Signup & Login 
app.post('/', (req, res) => {
  const { username, password } = req.body
  
  if (!username || !password) {
    res.render('error', {
      message: 'Please provide both username and password'
    })
    return
	}

	console.log(req.body, username, password);
	
	const saveSessionAndRenderDashboard = userId => {
		req.session.userId = userId
		req.session.save()
		client.hkeys('users', (err, users) => {
			// console.log(users)
			res.redirect('/')
		})
	}

	const handleSignUp = (username, password) => {
		client.incr('userId', async (err, userId) => {
			// create new user
			client.hset('users', username, userId)

			// hash password
			const saltRounds = 10
			const hash = await bcrypt.hash(password, saltRounds)

			client.hmset(`user:${userId}`, 'hash', hash, 'username', username)

			saveSessionAndRenderDashboard(userId)
		})
	}

	const handleLogin = (userId, password) => {
		client.hget(`user:${userId}`, 'hash', async (err, hash) => {
			const result = await bcrypt.compare(password, hash)

			if(result) {
				// password ok
				saveSessionAndRenderDashboard(userId)
			} else {
				// wrong password
				res.render('error', {
					message: 'Incorrect Password'
				})
				return
			}
		})
	}

	client.hget('users', username, (err, userId) => {
		if(!userId) {
			// signup
			handleSignUp(username, password)
		} else {
			// login
			handleLogin(userId, password)
		}
	})
})

// Post Message

app.get('/post', (req, res) => {
	if(req.session.userId) {
		res.render('post')
	} else {
		res.render('login')
	}
})

app.post('/post', (req, res) => {
	// check if user logged in
	if(!req.session.userId) {
		res.render('login')
		return
	}

	const { message } = req.body

	client.incr('postId', async (err, postId) => {
		// store userId, message & timestamp in created post
		client.hmset(`post:${postId}`, 'userId', req.session.userId, 'message', message, 'timestamp', Date.now())

		res.redirect('/')
	})
})

// Track following & followers

app.post('/follow', (req, res) => {
	if(!req.session.userId) {
		res.render('login')
		return
	}

	const { username } = req.body

	client.hget(`user:${req.session.userId}`, 'username', (err, currentUserName) => {
		client.sadd(`following:${currentUserName}`, username)
		client.sadd(`followers:${username}`, currentUserName)
	})

	res.redirect('/')
})

app.listen(port, () => console.log(`App listening on port ${port}!`))