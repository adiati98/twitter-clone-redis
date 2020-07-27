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
	if(req.session.userId) {
		res.render('dashboard')
	} else {
		res.render('login')
	}
})

// receive login and password
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
		res.render('dashboard')
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

app.listen(port, () => console.log(`App listening on port ${port}!`))