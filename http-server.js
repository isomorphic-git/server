#!/usr/bin/env node
var http = require('http')
var factory = require('./middleware')
var cors = require('./cors')

var config = {}

var server = http.createServer(cors(factory(config)))
server.listen(process.env.GIT_HTTP_MOCK_SERVER_PORT || 8174)

console.log(require('./logo.js'))
