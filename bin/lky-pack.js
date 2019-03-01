#! /usr/bin/env node
const path = require('path');

// 读取webpack.config.js中的config
let config = require(path.resolve('webpack.config.js'));

const Compiler = require('../lib/Compiler.js');
let compiler = new Compiler(config);

//plugin 钩子
compiler.hooks.entryOption.call();  

compiler.run();