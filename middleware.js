const fs = require('fs')
const fp = require('fs').promises
const path = require('path')
const url = require('url')
const EventEmitter = require('events').EventEmitter
const { E, indexPack, plugins, readObject, verify } = require('isomorphic-git')
const { serveInfoRefs, serveReceivePack, parseReceivePackRequest } = require('isomorphic-git/dist/for-node/isomorphic-git/internal-apis.js')
const { pgp } = require('@isomorphic-git/pgp-plugin')

let ee = new EventEmitter()
plugins.set('emitter', ee)
plugins.set('fs', fs)
plugins.set('pgp', pgp)

const chalk = require('chalk')
const is = require('./identify-request.js')
const parse = require('./parse-request.js')
const { lookup, demote } = require('./lookup.js')

function pad (str) {
  return (str + '    ').slice(0, 7)
}

function abbr (oid) {
  return oid.slice(0, 7)
}

const sleep = ms => new Promise(cb => setTimeout(cb, ms))

function log(req, res) {
  const color = res.statusCode > 399 ? chalk.red : chalk.green
  console.log(color(`[git-server] ${res.statusCode} ${pad(req.method)} ${req.url}`))
  return false
}

function factory (config) {
  return async function middleware (req, res, next) {
    const u = url.parse(req.url, true)
    if (!next) next = () => void(0)

    if (is.preflightInfoRefs(req, u)) {
      res.statusCode = 204
      res.end('')
    } else if (is.preflightPull(req, u)) {
      res.statusCode = 204
      res.end('')
    } else if (is.preflightPush(req, u)) {
      res.statusCode = 204
      res.end('')
    } else if (is.infoRefs(req, u)) {
      let { gitdir, service } = parse.infoRefs(req, u)
      gitdir = path.join(__dirname, gitdir)
      const { headers, response } = await serveInfoRefs({ fs, gitdir, service })
      for (const header in headers) {
        res.setHeader(header, headers[header])
      }
      res.statusCode = 200
      for (const buffer of response) {
        res.write(buffer)
      }
      res.end()
    } else if (is.pull(req, u)) {
      const { gitdir } = parse.pull(req, u)
      res.statusCode = 500
      res.end('Unsupported operation\n')
    } else if (is.push(req, u)) {
      let { gitdir, service } = parse.push(req, u)
      try {
        let { capabilities, updates, packfile } = await parseReceivePackRequest(req)

        // Save packfile to quarantine folder
        const dir = await fp.mkdtemp(path.join(__dirname, 'quarantine', gitdir + '-'))
        let filepath = 'pack-.pack'
        const stream = fs.createWriteStream(path.join(dir, filepath))
        let last20
        for await (const buffer of packfile) {
          if (buffer) {
            last20 = buffer.slice(-20)
            stream.write(buffer)
          }
        }
        stream.end()
        if (last20 && last20.length === 20) {
          last20 = last20.toString('hex')
          const oldfilepath = filepath
          filepath = `pack-${last20}.pack`
          await fp.rename(path.join(dir, oldfilepath), path.join(dir, filepath))
        }
        gitdir = path.join(__dirname, gitdir)

        // send HTTP response headers
        const { headers } = await serveReceivePack({ type: 'service', service })
        res.writeHead(200, headers)

        // index packfile
        res.write(await serveReceivePack({ type: 'print', message: 'Indexing packfile...' }))
        console.log('Indexing packfile...')
        await sleep(1)
        let currentPhase = null
        const listener = async ({ phase, loaded, total, lengthComputable }) => {
          let np = phase !== currentPhase ? '\n' : '\r'
          currentPhase = phase
          res.write(await serveReceivePack({ type: 'print', message: `${np}${phase} ${loaded}/${total}` }))
          res.flush()
        }
        let oids
        try {
          ee.on(`${last20}:progress`, listener)
          oids = await indexPack({ fs, gitdir, dir, filepath, emitterPrefix: `${last20}:` })
          await sleep(1)
          res.write(await serveReceivePack({ type: 'print', message: '\nIndexing completed' }))
          res.write(await serveReceivePack({ type: 'unpack', unpack: 'ok' }))
        } catch (e) {
          res.write(await serveReceivePack({ type: 'print', message: '\nOh dear!' }))
          res.write(await serveReceivePack({ type: 'unpack', unpack: e.message }))

          for (const update of updates) {
            res.write(await serveReceivePack({ type: 'ng', ref: update.fullRef, message: 'Could not index pack' }))
          }
          throw e
        } finally {
          ee.removeListener(`${last20}:progress`, listener)
        }
        await sleep(1)

        // Move packfile and index into repo
        await fp.rename(path.join(dir, filepath), path.join(gitdir, 'objects', 'pack', filepath))
        await fp.rename(path.join(dir, filepath.replace(/\.pack$/, '.idx')), path.join(gitdir, 'objects', 'pack', filepath.replace(/\.pack$/, '.idx')))
        await fp.rmdir(path.join(dir))

        // Verify objects (ideally we'd do this _before_ moving it into the repo... but I think we'd need a custom 'fs' implementation with overlays)
        res.write(await serveReceivePack({ type: 'print', message: '\nVerifying objects...\n' }))
        let i = 0

        for (const oid of oids) {
          i++
          res.write(await serveReceivePack({ type: 'print', message: `\rVerifying object ${i}/${oids.length}` }))
          const { type, object } = await readObject({ gitdir, oid })
          if (type === 'commit' || type === 'tag') {
            const email = type === 'commit' ? object.author.email : object.tagger.email
            res.write(await serveReceivePack({ type: 'print', message: `\nVerifying ${type} ${abbr(oid)} by ${email}: ` }))
            let keys
            try {
              keys = await lookup(email) 
            } catch (e) {
              res.write(await serveReceivePack({ type: 'print', message: `no keys found 👎\n` }))
              throw e
            }
            if (keys.length === 0) {
              res.write(await serveReceivePack({ type: 'print', message: `no keys found 👎\n` }))
              throw new Error(`\nSignature verification failed for ${type} ${abbr(oid)}. No PGP keys could be found for ${email}.\n`)
            }
            let ok = false
            for (const key of keys) {
              const result = await verify({ gitdir, ref: oid, publicKeys: key })
              if (result === false) {
                demote(email, key)
              } else {
                res.write(await serveReceivePack({ type: 'print', message: `signed with ${result[0]} 👍\n` }))
                ok = true
                break
              }
            }
            if (!ok) {
              res.write(await serveReceivePack({ type: 'print', message: `no keys matched 👎\n` }))
              throw new Error(`\nSignature verification failed for ${type} ${abbr(oid)}. It was not signed with a key publicly associated with the email address "${email}".

Learn how you can associate your GPG key with your email account using GitHub here:
https://help.github.com/en/github/authenticating-to-github/adding-a-new-gpg-key-to-your-github-account
`)
            }
          }
          // await sleep(1)
        }

        res.write(await serveReceivePack({ type: 'print', message: `\nVerification complete` }))

        // refs
        for (const update of updates) {
          res.write(await serveReceivePack({ type: 'ok', ref: update.fullRef }))
        }

        // gratuitous banner
        res.write(await serveReceivePack({ type: 'print', message: '\n' + require('./logo.js') }))
      } catch (e) {
        if (e.message === 'Client is done') {
          res.statusCode = 200
        } else if (e.code && e.code === E.NoSignatureError) {
          res.write(await serveReceivePack({ type: 'print', message: `no signature 👎\n` }))
          res.write(await serveReceivePack({ type: 'error', message: e.message + `

This server's policy is to only accept GPG-signed commits.
Learn how you can create a GPG key and configure git to sign commits here:
https://help.github.com/en/github/authenticating-to-github/managing-commit-signature-verification
` }))
        } else {
          res.write(await serveReceivePack({ type: 'error', message: e.message }))
        }
      } finally {
        // fin
        res.write(await serveReceivePack({ type: 'fin' }))
        res.end('')
      }
    }
    log(req, res)
  }
}

module.exports = factory
