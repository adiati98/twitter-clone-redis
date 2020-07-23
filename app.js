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
			maxAge: 36000000, //10 hours, in milliseconds
			httpOnly: false,
			secure: false,
		},
		secret: secret,
	})
);



app.get('/', (req, res) => res.render('index'))

// receive login and password
app.post('/', (req, res) => {
  const { username, password } = req.body
  
  if (!username || !password) {
    res.render('error', {
      message: 'Please provide both username and password'
    })
    return
  }

  client.hget('users', username, (err, userId) => {
		if (!userId) {
			// user does not exist, signup procedure
			client.incr('userId', async (err, userId) => {
        client.hset('users', username, userId)

        // create password hash
        const saltRounds = 10
        const hash = await bcrypt.hash(password, saltRounds)

        client.hset(`user:${userId}`, 'hash', hash, 'username', username)
			});
		} else {
			// user exists, login procedure
		}
	});

  console.log(req.body, username, password)
  res.end()
})



app.listen(port, () => console.log(`App listening on port ${port}!`))