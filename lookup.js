// TODO: replace with a LRU cache
const cache = {}
const get = require('simple-get')

module.exports = (username) =>
  fetch()
  .then(res => res.json())
  .then(json => {
    return json.map(data => data.raw_key)
  })

async function usernames2keys(usernames) {
  const all = await Promise.all(
    usernames.map(username => new Promise((resolve, reject) => {
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
    }))
  )
  return all.reduce((a, b) => a.concat(b)).filter(Boolean)
}

async function email2usernames(email) {
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
        return reject(new Error(`Could not find the GitHub user publicly associated with the email address "${email}"`))
      } else if (data.total_count > 0) {
        return resolve(data.items.map(i => i.login))
      } else {
        return reject('Unexpected value for data.total_count returned by GitHub API')
      }
    })
  })
}

async function lookup(email) {
  if (cache[email]) return cache[email]
  const usernames = await email2usernames(email)
  const keys = await usernames2keys(usernames)
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