const fs = require('fs');
const path = require('path');
// babylon 源码->ast
// @babel/traverse 遍历ast节点
// @babel/types 替换节点
// @babel/generator
// ejs 模板渲染
// tapable 串联插件
const babylon = require('babylon');
const traverse = require('@babel/traverse').default; //es6模块
const t = require('@babel/types');
const generator = require('@babel/generator').default;
const ejs = require('ejs');
const { SyncHook } = require('tapable');

class Compiler {
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
          loader = require(use[j]);
          content = loader(content);
          console.log("content", content);
        }
      }
    }
    return content;
  }

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
          let moduleName = node.arguments[0].value; //取到的就是模块引用名字 index.js=> ./a.js
          moduleName = moduleName + (path.extname(moduleName) ? '' : '.js'); // ./a.js
          moduleName = './' + path.join(parentPath, moduleName); // './src/a.js'
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
    //拿到模块内容
    let source = this.getSource(modulePath);

    //模块id modulePath(相对) = modulePath(绝对) - this.root   => ./src/index.js
    let moduleName = './' + path.relative(this.root, modulePath);

    if(isEntry) {
      this.entryId = moduleName; //保存入口的名字
    }
    //console.log(source, moduleName);  //index.js文件内容 ./src\index.js

    // 解析 需要把source源码进行改造 返回一个依赖列表
    let { sourceCode, dependencies } = this.parse(source, path.dirname(moduleName));

    // 把相对路径和模块中的内容对应起来
    this.modules[moduleName] = sourceCode;
    
    dependencies.forEach(dep => {
      //递归   附模块加载
      this.buildModule(path.join(this.root, dep), false);
    })
  }

  emitFile() {
    // 用数据 渲染我们的输出文件
    let main = path.join(this.config.output.path, this.config.output.filename); //输出路径
    let templateStr = this.getSource(path.join(__dirname, 'main.ejs')); //模板路径
    let code = ejs.render(templateStr, { entryId: this.entryId, modules: this.modules});
    this.assets = {};
    // 资源中 路径对应的代码
    this.assets[main] = code;
    console.log("main", main);
    fs.writeFileSync(main, this.assets[main]);
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
}

module.exports = Compiler;