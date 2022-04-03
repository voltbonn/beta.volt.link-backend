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
    ? '../volt.link-frontend/build/'
  : '../volt.link-frontend/'
)

function checkOrigin(origin){
  return (
    typeof origin === 'string'
    && (
      origin === 'volt.link'
      || origin.endsWith('volt.link')

      // allow from subdomains
      || origin.endsWith('.volt.link')

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

async function getBlockBySlug(slug, headers = {}) {
  return new Promise(resolve => {
    fetch((
      isDevEnvironment
      ? 'http://localhost:4004/graphql/v1/'
      : 'https://api.volt.link/graphql/v1/'
    ), {
      method: 'POST',
      body: JSON.stringify({
        query: `query ($slug: String!) {
          block: blockBySlug (slug: $slug) {
    	  	  _id
            properties
          }
        }`,
        variables: {
          slug,
        }
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      }
    })
    .then(async data => {
      data = await data.json()
      if (
        data
        && data.data
        && data.data.block
      ) {
        resolve(data.data.block)
      } else {
        resolve(null)
      }
    })
    .catch(error => {
      console.error(error)
      resolve(null)
    })
  })
}

async function getBlockById(id, headers = {}) {
  return new Promise(resolve => {
    fetch((
      isDevEnvironment
      ? 'http://localhost:4004/graphql/v1/'
      : 'https://api.volt.link/graphql/v1/'
    ), {
      method: 'POST',
      body: JSON.stringify({
        query: `query ($_id: ObjectID!) {
          block (_id: $_id) {
    	  	  _id
            properties
          }
        }`,
        variables: {
          _id: id,
        }
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      }
    })
    .then(async data => {
      data = await data.json()
      if (
        data
        && data.data
        && data.data.block
      ) {
        resolve(data.data.block)
      } else {
        resolve(null)
      }
    })
    .catch(error => {
      console.error(error)
      resolve(null)
    })
  })
}

async function getBlockBySlugOrId(slugOrId, headers = {}) {
  let block = await getBlockBySlug(slugOrId, headers)
  if (block) {
    return {
      block,
      used_query: 'slug',
    }
  } else {
    block = await getBlockById(slugOrId, headers)
    return {
      block,
      used_query: 'id',
    }
  }
}

function normalizeSlug(slug){
  if (typeof slug === 'string') {
    return slug.toLowerCase()
  }

  return null
}

function showClient(res){
  // send index file to show client
  res.sendFile(static_files_path+'/index.html')
  // The client needs to check if the block exists OR if a error page should be shown.
  // AND the client should to correct the slug if it's wrong.
  // (TODO: There currently is no function to find the correct slug from an id.)
}

function redirectSlug(options) {
  const {
    block,
    res,
    req,
  } = options

  const group0 = req.params[0] // slug (or id if group1 is empty) // capture-group before separator
  // const group1 = req.params[1] // id // capture-group after separator
  const group2 = req.params[2] // suffix


  if (
    !!block
    && block.hasOwnProperty('properties')
    && block.properties.hasOwnProperty('action')
    && block.properties.action.hasOwnProperty('type')
  ) {
    if (block.properties.action.type === 'render_block') {
      if (block.properties.action.blockId) {
        // render block of blockId
        res.redirect(`/${group0}=${block.properties.action.blockId}${group2}`)
      } else {
        // render this block
        res.redirect(`/${group0}=${block._id}${group2}`)
      }
    } else if (
      block.properties.action.type === 'open_url'
      && typeof block.properties.action.url === 'string'
      && block.properties.action.url !== ''
    ) {
      // go to mentioned url
      res.redirect(block.properties.action.url)
    } else {
      // error (handles by client)
      showClient(res)
    }
  } else {
    // error (handles by client)
    showClient(res)
  }

}

app.get(/^\/([^=/]*)(?:=?)([^=/]*)(.*)/, async function (req, res, next) {
  const headers = {
    cookie: req.headers.cookie, // for authentication
    'user-agent': req.headers['user-agent'], // for analytics
    referer: req.headers.referer, // for analytics
  }
  
  const group0 = req.params[0] // slug (or id if group1 is empty) // capture-group before separator
  const group1 = req.params[1] // id // capture-group after separator
  // const group2 = req.params[2] // suffix

  if (!!group0 && !group1) {
    // check if group0 is ID by finding it in the database
    const block = await getBlockById(group0, headers)
    if (block) {
      // group0 is an ID
      showClient(res)
    } else {
      // group0 is not an id
      // check if group0 is a slug
      const block = await getBlockBySlug(group0, headers)
      if (block) {
        // group0 is a slug
        // redirect it accoringly
        // TODO: Here is the place to add in the automations and actions for the path trigger.
        redirectSlug({
          block,
          req,
          res,
        })
      } else {
        // captureGroupBeforeSeparator is probably a file. Not a slug or id.
        // So go to the next route.
        // The next route shows static files.
        next('route')
      }
    }
  } else {
    showClient(res)
  }
})

app.use(express.static(static_files_path))

app.get('*', function (req, res, next) {
  res.sendFile(static_files_path+'/index.html')
})

const port = 4003
const host = '0.0.0.0' // Uberspace wants 0.0.0.0
http.createServer(app).listen({ port, host }, () =>
  console.info(`
    🚀 Server ready
    For uberspace: http://${host}:${port}/
    For local development: http://localhost:${port}/
  `)
)

