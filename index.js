require('dotenv').config()

const isDevEnvironment = process.env.environment === 'dev' || false
const path = require('path')
const url = require('url')

const http = require('http')

const express = require('express')
const RateLimit = require('express-rate-limit')

const { fetch } = require('cross-fetch')

const fs = require('fs')


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
      || origin.endsWith('://volt.link')

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
  max: 1000, // requests per minute
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

function getImageUrl(imageObj) {
  if (
    typeof imageObj === 'object'
    && imageObj !== null
    && !Array.isArray(imageObj)
  ) {
    if (imageObj.type === 'url') {
      return imageObj.url || ''
    }
  }

  return ''
}

function showClient(res, block) {
  // send index file to show client
  const index_file_path = static_files_path + '/index.html'

  // load index file
  fs.readFile(index_file_path, 'utf8', function (err, index_file) {
    if (err) {
      console.error(err)
      res.sendStatus(500)
    } else {
      let title = 'VoltLink'
      let description = 'VoltLink is an information-hub about Volt Europa.'
      let coverphoto_url = ''

      if (block && block.hasOwnProperty('properties')) {
        if (
          typeof block.properties.text === 'string'
          && block.properties.text.length > 0
        ) {
          title = block.properties.text
          description = ''
        }

        coverphoto_url = getImageUrl(block.properties.coverphoto)
        if (!coverphoto_url) {
          coverphoto_url = getImageUrl(block.properties.icon)
        }
      }

      if (coverphoto_url !== '') {
        coverphoto_url = `https://api.volt.link/download_url?f=jpg&w=1000&h=1000&url=${encodeURIComponent(coverphoto_url)}`
      }

      index_file = index_file
        .replace(/__META_TITLE__/g, title)
        .replace(/__META_DESCRIPTION__/g, description)
        .replace(/__META_COVERPHOTO__/g, coverphoto_url)
        // .replace(/__SERVER_DATA__/g, JSON.stringify({
        //   block: block,
        // }))

      res.send(index_file)
    }
  })

  // The client needs to check if the block exists OR if a error page should be shown.
  // AND the client should to correct the slug if it's wrong.
  // (TODO: There currently is no function to find the correct slug from an id.)
}

function normalizeSlug(slug) {
  if (typeof slug === 'string') {
    slug = slug
      .trim()
      .toLowerCase()
    // .replace(/_/g, '-')

    return slug
  }

  return null
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

  if (!block.hasOwnProperty('properties')) {
    block.properties = {}
  }

  if (
    ! (
      block.properties.hasOwnProperty('action')
      && block.properties.action.hasOwnProperty('type')
    )
  ) {
    block.properties.action = {
      type: 'render_block',
    }
  }

  if (
    !!block
    && block.properties.hasOwnProperty('action')
    && block.properties.action.hasOwnProperty('type')
  ) {
    if (block.properties.action.type === 'render_block') {
      const slug = normalizeSlug(group0)
      if (block.properties.action.blockId) {
        // render block of blockId
        res.redirect(`/${slug}=${block.properties.action.blockId}${group2}`)
      } else {
        // render this block
        res.redirect(`/${slug}=${block._id}${group2}`)
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
      showClient(res, block)
    }
  } else {
    // error (handles by client)
    showClient(res, block)
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

  if (!!group0 && !!group1) {
    const block = await getBlockById(group1, headers)
    showClient(res, block)
  } else if (!!group0 && !group1) {
    // check if group0 is ID by finding it in the database
    const block = await getBlockById(group0, headers)
    if (block) {
      // group0 is an ID
      showClient(res, block)
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
  showClient(res) // show index.html as a fallback
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

