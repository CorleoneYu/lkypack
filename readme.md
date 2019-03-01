# lkypack

## 准备

### lky-dev代码准备

```javascript
|-- lky-dev
| |-- src
| | |-- index.js  //入口文件
| | |-- a.js  //被index.js引用
| | |-- base
| | | |-- b.js  //被a.js引用
| |-- webpack.config.js

//webpack.config.js
module.exports = {
  mode: 'development',
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist')
  },
}

// index.js 引用a.js
let str = require('./a.js');
console.log(str);

// a.js 引入用b.js
let b = require('./base/b.js')
module.exports = 'a' + b;

// /base/b.js
module.exports = 'b';
```

### webpack尝试打包

```javascript
//  dist/main.js webpack打包后的文件
// 有删减
(function (modules) { // webpackBootstrap
  // The module cache
  var installedModules = {};

  // The require function
  function __webpack_require__(moduleId) {

    // Check if module is in cache
    if (installedModules[moduleId]) {
      return installedModules[moduleId].exports;
    }
    // Create a new module (and put it into the cache)
    var module = installedModules[moduleId] = {
      i: moduleId,
      l: false,
      exports: {}
    };

    // Execute the module function
    modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

    // Flag the module as loaded
    module.l = true;

    // Return the exports of the module
    return module.exports;
  }
  return __webpack_require__(__webpack_require__.s = "./src/index.js");
})
({
  "./src/a.js":
    (function (module, exports, __webpack_require__) {
      eval("let b = __webpack_require__(/*! ./base/b.js */ \"./src/base/b.js\")\r\n\r\nmodule.exports = 'a' + b;\n\n//# sourceURL=webpack:///./src/a.js?");
    }),
  "./src/base/b.js":
    (function (module, exports) {
      eval("module.exports = 'b';\n\n//# sourceURL=webpack:///./src/base/b.js?");
    }),
  "./src/index.js":
    (function (module, exports, __webpack_require__) {
      eval("let str = __webpack_require__(/*! ./a.js */ \"./src/a.js\");\r\nconsole.log(str);\n\n//# sourceURL=webpack:///./src/index.js?");
    })
});
```

### 分析打包后的文件

#### 分析

1. wepack实现了__webpack_require__
2. 立即执行函数中使用闭包对模块进行缓存(设计模式->缓存)
3. __webpack_require__构建模块依赖
4. 立即执行函数中将入口src/index.js传入__webpack_require__
5. 模块中的源代码使用eval运行

#### 启发

1. 模块依赖的文件名作为key,源代码作为value, 这样构成的对象作为参数传入立即执行函数
2. 可以将main.js作为模板,在node中利于ejs渲染,替换参数对象

## 手写lky-pack

### 初始化

```javascript
|-- lky-pack
| |-- bin
| | |-- lky-pack.js  //入口文件
| |-- lib
| | |-- Compiler.js
| | |-- main.ejs
| |-- package.json //配置文件

//package.json
{
  "name": "lky-pack",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "bin": {
    "lky-pack": "./bin/lky-pack.js" //运行bin/lky-pack.js
  },
  "license": "MIT",
  "dependencies": {
    "@babel/generator": "^7.3.3",
    "@babel/traverse": "^7.2.3",
    "@babel/types": "^7.3.3",
    "babylon": "^6.18.0",
    "ejs": "^2.6.1",
    "tapable": "^1.1.1"
  }
}

// bin/lky-pack.js
#! /usr/bin/env node  //使用Node运行
console.log('start');
```

#### npm link

```cmd
// lky-pack项目下
npm link
```

全局node_modules下会生成lky-pack的快捷方式

```cmd
// lky-dev项目下
npm link lky-pack

npx lky-pack //输出 start
```

将全局node_modules下的lky-pack映射到该项目node_modules中(该项目可以执行lky-pack命令)

### lky-pack框架

```javascript
// bin/lky-pack.js
// 读取webpack.config.js中的config
let config = require(path.resolve('webpack.config.js'));

const Compiler = require('../lib/Compiler.js');
let compiler = new Compiler(config);
compiler.run();

// lib/Compiler.js
class Compiler {
  constructor(config) {
    this.config = config;
    //保存入口文件的路径
    this.entryId;
    this.entry = config.entry;  //入口相对路径 './src/index.js'
    this.root = process.cwd();  //命令行脚本工作路径 lky-dev
    this.modules = {}
  }

  //构建modules 也就是那个参数
  buildModule(modulePath, isEntry) {

  }
  
  //打包文件
  emitFile() {}

  run() {
    // 从入口路径开始构建modules
    this.buildModule(path.resolve(this.root, this.entry), true);

    this.emitFile();
  }
}

module.exports = Compiler;
```

### buildModule

```javascript
// this.modules的目标
{
  "./src/a.js": 'a.js的代码',
  "./src/base/b.js": 'b.js的代码',
  "./src/index.js": 'index.js的代码'
}
```

明确一下buildModule的作用

```javascript
// class Compiler中

//获取文件中的代码
getSource(modulePath) {
  let content = fs.readFileSync(modulePath, 'utf8');
  return content;
}

//构建modules 也就是那个参数
buildModule(modulePath, isEntry) {
  let source = this.getSource(modulePath);

  //模块id modulePath(相对) = modulePath(绝对) - this.root
  let moduleName = './' + path.relative(this.root, modulePath); //例如：./src/index.js

  if(isEntry) {
    this.entryId = moduleName; //保存入口的名字
  }

  // 解析 需要把source源码进行改造 返回一个依赖列表
  let { sourceCode, dependencies } = this.parse(source, path.dirname(moduleName));

  // 把相对路径和模块中的内容对应起来
  this.modules[moduleName] = sourceCode;
}
```

### parse

[AST查阅](https://chenweilin.xin)
参数：源码、模块目录路径  
功能：

1. 使用babylon构建AST
2. 使用@babel/traverse遍历节点：找到require语法结点，将require替换成__webpack_require__，并添加到dependencies中
3. 使用@babel/types将模块引用相对于index.js的路径改成相对于根路径的相对路径
4. 因为以上修改在AST上，所以需使用@babel/generatorc将新的AST转化成代码

```javascript
// 解析源码
parse(source, parentPath) {
  //AST解析语法树
  let ast = babylon.parse(source);

  let dependencies = [];

  //遍历AST
  traverse(ast, {
    CallExpression(p) {
      let node = p.node; //对应的节点
      if (node.callee.name === 'require') {
        node.callee.name = '__webpack_require__'; // 'require' => '__webpack_require__'
        let moduleName = node.arguments[0].value; //取到的就是模块引用名字 如：index.js中引用 ./a.js
        moduleName = moduleName + (path.extname(moduleName) ? '' : '.js'); // 补充扩展名
        moduleName = './' + path.join(parentPath, moduleName); // './src/a.js' 相对于根路径的相对路径
        dependencies.push(moduleName); //依赖
        node.arguments = [t.stringLiteral(moduleName)]; //修改源码
      }
    }
  });
  let sourceCode = generator(ast).code;
  return {
    sourceCode,
    dependencies,
  }
}

//构建模块
buildModule(modulePath, isEntry) {
  //...Code
  dependencies.forEach(dep => {
    //递归   附模块加载
    this.buildModule(path.join(this.root, dep), false);
  })
}
```

### emitFile

功能：用模板(main.ejs)+数据(构建出来的modules) 生成目标文件

```javascript
//模板 main.ejs
(function (modules) { // webpackBootstrap
  // The module cache
  var installedModules = {};

  // The require function
  function __webpack_require__(moduleId) {

    // Check if module is in cache
    if (installedModules[moduleId]) {
      return installedModules[moduleId].exports;
    }
    // Create a new module (and put it into the cache)
    var module = installedModules[moduleId] = {
      i: moduleId,
      l: false,
      exports: {}
    };

    // Execute the module function
    modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

    // Flag the module as loaded
    module.l = true;

    // Return the exports of the module
    return module.exports;
  }
  return __webpack_require__(__webpack_require__.s = "<%-entryId%>"); //渲染入口路径
})

//主要这一块 将this.modules代入
({
  <%for(let key in modules){%>
    "<%-key%>":
    (function (module, exports, __webpack_require__) {
      eval(`<%-modules[key]%>`);
    }),
  <%}%>
});

emitFile() {
  // 用数据 渲染我们的输出文件
  let main = path.join(this.config.output.path, this.config.output.filename); //输出路径
  let templateStr = this.getSource(path.join(__dirname, 'main.ejs')); //模板路径
  //模板+数据=代码
  let code = ejs.render(templateStr, { entryId: this.entryId, modules: this.modules});
  this.assets = {};
  // 资源中 路径对应的代码
  this.assets[main] = code;
  fs.writeFileSync(main, this.assets[main]);
}
```

### 执行生成目标文件

```javascript
// lky-dev中dist=>bundle.js
({
  
  "./src\index.js":
  (function (module, exports, __webpack_require__) {
    eval(`let str = __webpack_require__("./src\\a.js");

__webpack_require__("./src\\index.less");

console.log(str);`);
  }),

  "./src\a.js":
  (function (module, exports, __webpack_require__) {
    eval(`let b = __webpack_require__("./src\\base\\b.js");

module.exports = 'a' + b;`);
  }),

  "./src\base\b.js":
  (function (module, exports, __webpack_require__) {
    eval(`module.exports = 'b';`);
  }),

});
```

打印出ab=>撒花庆祝

### 预支持loader

```javascript
|-- lky-dev
| | //....
| |-- loader
| | |-- less-loader.js
| | |-- style-loader.js

// lky-dev webpack.config.js
module: {
  rules: [
    {
      test: /\.less$/,
      use: [
        path.resolve(__dirname, 'loader', 'style-loader'),
        path.resolve(__dirname, 'loader', 'less-loader')
      ]
    }
  ]
},

// less-loader  用less模块将less转换成css
const less = require('less');
function loader(source) {
  let css = '';
  less.render(source, function (err, c) {
    css = c.css;
  });
  css = css.replace(/\n/g, '\\n');  //转义问题
  return css;
}

module.exports = loader;

// style-loader 将css插入html head标签中
function loader(source) {
  let style =  `
    let style = document.createElement('style');
    style.innerHTML = ${JSON.stringify(source)};
    document.head.appendChild(style);
  `;
  return style;
}
module.exports = loader;
```

### 改造getSource

```javascript
// lky-pack lib/Compiler.js
// 读取代码，判断是否该文件被rules命中
getSource(modulePath) {
  let rules = this.config.module.rules;
  let content = fs.readFileSync(modulePath, 'utf8');

  //遍历rules 看看是否匹配
  for (let i = 0; i < rules.length; i++) {
    let rule = rules[i];
    let { test, use } = rule;

    if (test.test(modulePath)) {  //这个模块需要loader来转化
      //遍历调用Loader
      let loader;
      for (let j = use.length - 1; j >= 0; j--) {
        //逆序使用loader
        loader = require(use[j]);
        content = loader(content);
      }
    }
  }
  return content;
}
```

### 预支持plugins

```javascript
//lky-dev webpack.config.js
class P {
  apply(compiler) {
    console.log('start');
    compiler.hooks.emit.tap('emit', function() {
      console.log('emit');
    })
  }
}

plugins: [
  new P(),
]
```

### 改造constructor并注入钩子

思路：

1. 在Compiler构造器中hooks创建tapable中的SyncHook
2. 读取config中的plugin, 并将compiler实例作为参数传入plugin,执行plugin的apply方法
3. plugin的apply选择挂载在compiler中hooks的哪个阶段，并传入回调函数
4. compiler在打包过程中依次触发各个阶段的hooks,执行plugin的回调

```javascript
// lky-pack lib/Compiler
constructor(config) {
  //output entry
  this.config = config;
  //保存入口文件的路径
  this.entryId;
  this.entry = config.entry;  //入口相对路径 './src/index.js'
  this.root = process.cwd();  //命令行脚本工作路径

  //保存所有模块依赖
  this.modules = {};

  //webpack钩子
  this.hooks = {
    entryOption: new SyncHook(), //入口钩子
    afterPlugins: new SyncHook(),
    compile: new SyncHook(),  //编译钩子
    afterCompile: new SyncHook(),
    run: new SyncHook(),
    emit: new SyncHook(),
    done: new SyncHook()
  };

  // 如果传递了plugins参数
  let plugins = this.config.plugins;
  if (Array.isArray(plugins)) {
    plugins.forEach(plugin => {
      plugin.apply(this); //在回调里面让plugins方法挂载到对应hook
    });
  }
  this.hooks.afterPlugins.call();
}

run() {
  // run plugin钩子
  this.hooks.run.call();

  // 编译前plugin钩子
  this.hooks.compile.call();

  // 执行 创建模块的依赖关系
  this.buildModule(path.resolve(this.root, this.entry), true);

  // 编译后plugin钩子
  this.hooks.afterCompile.call();

  // 打包后的文件
  this.emitFile();

  // 打包后plugin钩子
  this.hooks.emit.call();

  //  生成文件后plugin钩子
  this.hooks.done.call();
}
```
