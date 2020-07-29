const express = require('express')
const redis = require('redis')
const bcrypt = require('bcrypt')
const session = require('express-session')
const path = require('path')
const { promisify } = require('util')
const { formatDistance } = require('date-fns')

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

// util.promisify functions
const ahget = promisify(client.hget).bind(client)
const asmembers = promisify(client.smembers).bind(client)
const ahkeys = promisify(client.hkeys).bind(client)
const aincr = promisify(client.incr).bind(client)
const alrange = promisify(client.lrange).bind(client)


// ROUTES

// Homepage
app.get('/', async (req, res) => {
	if(req.session.userId) {
		const currentUserName = await ahget(`user:${req.session.userId}`, 'username')
		const following = await asmembers(`following:${currentUserName}`)
		const users = await ahkeys('users')

		const timeline = []
		const posts = await alrange(`timeline:${currentUserName}`, 0, 100)

		console.log(`timeline: ${timeline}`);

		// timeline handling
		for (post of posts) {
      const timestamp = await ahget(`post:${post}`, 'timestamp')
      const timeString = formatDistance(
        new Date(),
        new Date(parseInt(timestamp))
      )

			timeline.push({
				message: await ahget(`post:${post}`, 'message'),
				author: await ahget(`post:${post}`, 'username'),
				timeString: timeString,
			})		
		}

		res.render('dashboard', {
			users: users.filter((user) => user !== currentUserName && following.indexOf(user) === -1),
			currentUserName,
			timeline
		})
		console.log(timeline);
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

// Handling Post Message

app.get('/post', (req, res) => {
	if(req.session.userId) {
		res.render('post')
	} else {
		res.render('login')
	}
})

app.post('/post', async (req, res) => {
	if(!req.session.userId) {
		res.render('login')
		return
	}

	const { message } = req.body

	const currentUserName = await ahget(`user:${req.session.userId}`, 'username')
	const postId = await aincr('postId')

	client.hmset(`post:${postId}`, 'userId', req.session.userId, 'username', username, 'message', message, 'timestamp', Date.now())
	client.lpush(`timeline:${currentUserName}`, postId)

	console.log(`post:${postId}`,
		'userId',
		req.session.userId,
		'usename',
		username,
		'message',
		message,
		'timestamp',
		Date.now());

	const followers = await asmembers(`followers:${currentUserName}`)
	console.log(`followers = ${followers}`)

	for (follower of followers) {
		client.lpush(`timeline:${follower}`, postId)
	}

	console.log(`timeline:${follower}`, postId);

	res.redirect('/')
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