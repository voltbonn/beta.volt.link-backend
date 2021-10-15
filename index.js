require('dotenv').config()

const isDevEnvironment = process.env.environment === 'dev' || false
const path = require('path')
const url = require('url')

const http = require('http')

const express = require('express')
const RateLimit = require('express-rate-limit')

const { fetch } = require('cross-fetch')

const static_files_path = path.join(__dirname,
  isDevEnvironment
  ? '../edit.volt.link/build/'
  : '../beta.volt.link/'
)

function checkOrigin(origin){
  return (
    typeof origin === 'string'
    && (
      // allow from subdomains
      origin.endsWith('.volt.link')

      // allow for localhost
      || origin.endsWith('localhost:3000')
      || origin.endsWith('localhost:4000')
      || origin.endsWith('0.0.0.0:3000')
      || origin.endsWith('0.0.0.0:4000')
      || origin.endsWith('localhost:19006')
    )
  )
}

// function getUserLocales(){
//     const localesByCounty = {
//       de: ['de'],
//     }
//   // https://get.geojs.io/v1/ip/geo/{ip address}.json
// }

const app = express()

// set up rate limiter: maximum of 100 requests per minute
app.use(new RateLimit({
  windowMs: 1*60*1000, // 1 minute
  max: 100, // requests per minute
})) // apply rate limiter to all requests

app.use(express.json())

app.use(function (req, res, next) {
  // const origin = req.get('origin')
  const origin = req.header('Origin')
  if (checkOrigin(origin)) {
    req.is_subdomain = true
    req.origin = origin
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', true)
  } else {
    req.is_subdomain = false
  }

  next()
})

app.options("/*", function (req, res, next) {
  // correctly response for cors
  if (req.is_subdomain) {
    res.setHeader('Access-Control-Allow-Origin', req.origin)
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With')
    res.sendStatus(200)
  } else {
    res.sendStatus(403)
  }
})

app.use(express.static(static_files_path))

app.get('/login', (req, res) => {
  res.redirect(url.format({
    pathname: '/auth/google',
    query: req.query,
  }))
})

app.get('/:slug', function (req, res, next) {
  let slug = req.params.slug
  slug = slug.toLowerCase()

  const real_path = req.query.real_path
  if (typeof real_path === 'string' && real_path !== '') {
    next('route')
  } else if (slug === 'edit'&& slug === 'view') {
    next('route')
  } else {
    fetch((
      isDevEnvironment
      ? 'http://localhost:4004/graphql/v1/'
      : 'http://api.volt.link/graphql/v1/'
    ), {
      method: 'POST',
      body: JSON.stringify({
        query: `query getBlockBySlug ($slug: String!) {
          blockBySlug (slug: $slug) {
    	  	  _id
          }
        }`,
        variables: {
          slug,
        }
      }),
      headers: {
        'content-type': 'application/json'
      }
    })
    .then(async data => {
      data = await data.json()
      if (
        data
        && data.data
        && data.data.blockBySlug
        && data.data.blockBySlug._id
      ) {
        res.redirect(`?real_path=/view/${data.data.blockBySlug._id}`)
      } else {
        next('route')
      }
    })
  }
})

app.use(express.static(static_files_path))

const port = 3000
const host = '0.0.0.0' // Uberspace wants 0.0.0.0
http.createServer(app).listen({ port, host }, () =>
  console.info(`
    🚀 Server ready
    For uberspace: http://${host}:${port}/
    For local development: http://localhost:${port}/
  `)
)

