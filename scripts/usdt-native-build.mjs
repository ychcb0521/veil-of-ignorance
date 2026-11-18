// A native verifier imports the same frozen-plan functions as the web app.
// Their unused persistence imports must not initialize a browser cloud client.
export const nativeUsdtBuildPlugin = {
  name:'native-unused-browser-persistence',
  setup(build) {
    build.onResolve({filter:/simStateSync(?:\.ts)?$/},async args=>{
      if(args.pluginData?.nativeResolved)return;
      const result=await build.resolve(args.path,{resolveDir:args.resolveDir,kind:args.kind,pluginData:{nativeResolved:true}});
      return {...result,sideEffects:false};
    });
  },
};
