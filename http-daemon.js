#!/usr/bin/env node
const cmdName = 'git-server'
const target = require.resolve('./http-server.js')
require('./daemon.js')(cmdName, target)
