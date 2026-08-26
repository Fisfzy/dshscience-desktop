/** dsh-danus client half 构建:官方 client bundle(cjs,__ModuleLoader__ 契约)。
 *
 * 模式照 dsh-loop 的 client 段:CJS、platform browser、react/react-dom 与
 * @deepseek-ai/dsh-client-* 全部 external(host 提供,不打进 bundle);
 * banner/footer/intro 把产物包装进 window.__ModuleLoader__.load 工厂。
 * host half 不经此构建(main 直指 src/plugins/gateway.ts,由 DSH 源码加载)。
 */

export default [
  {
    name: '@fisfzy/dsh-danus/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: true,
    external: [/@deepseek-ai\/dsh-client-/, 'react', 'react-dom'],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-danus", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
