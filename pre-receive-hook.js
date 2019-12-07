(async () => {
  console.log('Wish me luck!')

  function abbr (oid) {
    return oid.slice(0, 7)
  }

  // Verify objects (ideally we'd do this _before_ moving it into the repo... but I think we'd need a custom 'fs' implementation with overlays)
  console.log('\nVerifying objects...\n')
  let i = 0

  for (const oid of oids) {
    i++
    console.log(`\rVerifying object ${i}/${oids.length}`)
    const { type, object } = await git.readObject({ oid })
    if (type === 'commit' || type === 'tag') {
      const email = type === 'commit' ? object.author.email : object.tagger.email
      console.log(`\nVerifying ${type} ${abbr(oid)} by ${email}: `)
      let keys
      try {
        keys = await pgp.lookup(email) 
      } catch (e) {
        console.fatal(`no keys found 👎\n`)
        return
      }
      if (keys.length === 0) {
        console.log(`no keys found 👎\n`)
        console.fatal(`\nSignature verification failed for ${type} ${abbr(oid)}. No PGP keys could be found for ${email}.\n`)
        return
      }
      let ok = false
      for (const key of keys) {
        let result
        try {
          result = await git.verify({ ref: oid, publicKeys: key })
        } catch (e) {
          if (e.code && e.code === git.E.NoSignatureError) {
            console.log(`no signature 👎\n`)
            console.fatal(e.message + `
  
  This server's policy is to only accept GPG-signed commits.
  Learn how you can create a GPG key and configure git to sign commits here:
  https://help.github.com/en/github/authenticating-to-github/managing-commit-signature-verification
  `)
            return
          } else {
            console.fatal(e.message)
            return
          }
        }
        if (result === false) {
          pgp.demote(email, key)
        } else {
          console.log(`signed with ${result[0]} 👍\n`)
          ok = true
          break
        }
      }
      if (!ok) {
        console.log(`no keys matched 👎\n`)
        console.fatal(`\nSignature verification failed for ${type} ${abbr(oid)}. It was not signed with a key publicly associated with the email address "${email}".

Learn how you can associate your GPG key with your email account using GitHub here:
https://help.github.com/en/github/authenticating-to-github/adding-a-new-gpg-key-to-your-github-account
`)
        return
      }
    }
  }

  console.log(`\nVerification complete`)
  done()
})()
