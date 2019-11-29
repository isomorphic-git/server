// TODO: replace with a LRU cache
const cache = {}
const get = require('simple-get')

module.exports = (username) =>
  fetch()
  .then(res => res.json())
  .then(json => {
    return json.map(data => data.raw_key)
  })

async function username2keys(username) {
  return new Promise((resolve, reject) => {
    get.concat({
      url: `https://api.github.com/users/${username}/gpg_keys`,
      json: true,
      headers: {
        'user-agent': 'GitHub PGP KeyFinder'
      }
    }, (err, res, data) => {
      if (err) return reject(err)
      return resolve(data.map(i => i.raw_key))
    })
  })
}

async function email2username(email) {
  return new Promise((resolve, reject) => {
    get.concat({
      url: `https://api.github.com/search/users?q=${email}+in:email`,
      json: true,
      headers: {
        'user-agent': 'GitHub PGP KeyFinder'
      }
    }, (err, res, data) => {
      if (err) return reject(err)
      if (data.total_count === 0) {
        return reject(new Error(`No GitHub user publicly associated with ${email}`))
      } else if (data.total_count > 1) {
        return reject(new Error(`Multiple GitHub users found for ${email}: ${JSON.stringify(data.items.map(i => i.login))}`))
      } else if (data.total_count === 1) {
        return resolve(data.items[0].login)
      } else {
        return reject('Unexpected value for data.total_count returned by GitHub API')
      }
    })
  })
}

async function lookup(email) {
  if (cache[email]) return cache[email]
  const username = await email2username(email)
  const keys = await username2keys(username)
  cache[email] = keys
  return cache[email]
}

function demote(email, key) {
  const i = cache[email].indexOf(key)
  cache[email].push(cache[email].splice(i, 1)[0])
}

module.exports.lookup = lookup
module.exports.demote = demote

if (!module.parent) {
  lookup('wmhilton@gmail.com').then(console.log).then(() => lookup('wmhilton@gmail.com')).then(console.log)
}