// minimal fake of the ArcGIS API pieces the map uses
(function(){
  class Base { constructor(p={}){ Object.assign(this,p); } }
  class Layer extends Base { constructor(p){ super(p); this.graphics=[]; } add(g){this.graphics.push(g)} addMany(a){this.graphics.push(...a)} removeAll(){this.graphics=[]} }
  class EMap extends Base { constructor(p){ super(p); this.layers=[]; this._b=p.basemap; } get basemap(){ return {load:()=>Promise.resolve()} } set basemap(v){this._b=v} add(l){this.layers.push(l)} addMany(a){this.layers.push(...a)} remove(l){this.layers=this.layers.filter(x=>x!==l)} }
  class View extends Base { constructor(p){ super(p); this.ui={move(){}}; window.__view=this; this.extent=new Extent({}); this.resolution=150; this.stationary=true; } when(cb){ setTimeout(cb,10); return Promise.resolve(); } goTo(){ return Promise.resolve(); } on(){} hitTest(){ return Promise.resolve({results:[]}); } }
  class Extent extends Base { expand(){ return this; } contains(){ return true; } }
  const mods={"esri/Map":EMap,"esri/views/MapView":View,"esri/Graphic":Base,"esri/layers/GraphicsLayer":Layer,"esri/layers/FeatureLayer":Base,"esri/geometry/Point":Base,"esri/geometry/Polyline":Base,"esri/geometry/Extent":Extent,"esri/core/reactiveUtils":{watch(){return {remove(){}}},when(){}}};
  window.require=(deps,cb)=>setTimeout(()=>cb(...deps.map(d=>mods[d])),0);
  const realFetch=window.fetch;
  window.fetch=async url=>{ const u=String(url); const which=u.includes("Lines")?"lines":"stations"; const off=+new URL(u).searchParams.get("resultOffset"); const all=window.__FAKE[which]; const page=all.features.slice(off,off+2000);
    return { json: async()=>({fields:all.fields,features:page,exceededTransferLimit: off+2000<all.features.length}) }; };
})();
