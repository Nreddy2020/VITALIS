"""Create an isolated FIN snapshot and application-only instrumentation overlay.
No source, credentials or storage are copied back to the original project.
"""
from pathlib import Path
import hashlib, json, shutil, sys
root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
dest = root / 'artifacts/mobile-pilot/fin-isolated'
dest.mkdir(parents=True, exist_ok=True)
records=[]
for folder in ['app','components','services','assets','config','constants','charts','utils','base']:
    if not (source/folder).exists(): continue
    for src in (source/folder).rglob('*'):
        if not src.is_file(): continue
        relative=src.relative_to(source)
        dst=dest/relative; dst.parent.mkdir(parents=True,exist_ok=True)
        data=src.read_bytes();dst.write_bytes(data)
        records.append({'path':relative.as_posix(),'sha256':hashlib.sha256(data).hexdigest()})
for name in ['package.json','package-lock.json','app.json','babel.config.js','metro.config.js','tailwind.config.js','global.css','tsconfig.json','nativewind-env.d.ts']:
    shutil.copyfile(source/name,dest/name)
    records.append({'path':name,'sha256':hashlib.sha256((source/name).read_bytes()).hexdigest()})
config=json.loads((dest/'app.json').read_text(encoding='utf-8-sig'))
config['expo'].update(name='FIN VITALIS isolated capture',slug='vitalis-fin-isolated-capture',scheme='vitalis-fin-isolated')
config['expo'].pop('owner',None);config['expo'].pop('extra',None)
(dest/'app.json').write_text(json.dumps(config,indent=2))
package=json.loads((dest/'package.json').read_text());package['main']='index.js';(dest/'package.json').write_text(json.dumps(package,indent=2))
(dest/'index.js').write_text("import './pilot/install';\nimport 'expo-router/entry';\n")
metro=dest/'metro.config.js'
metro.write_text(metro.read_text().replace('const config = getDefaultConfig(__dirname);', 'const config = getDefaultConfig(__dirname);\nconfig.watchFolders = [];'))
runtime=dest/'services/runtimeConfig.js'
text=runtime.read_text();text=text.replace('trimTrailingSlashes(env.EXPO_PUBLIC_API_URL)', "'http://127.0.0.1:8362'")
runtime.write_text(text)
pilot=dest/'pilot';pilot.mkdir(exist_ok=True)
shutil.copyfile(root/'engine/ingestion/fetch_observer.js',pilot/'fetch_observer.js')
# In-memory storage overlays keep ALL existing native FIN storage untouched.
(pilot/'asyncStorage.js').write_text('''const values = new Map();
const store = {
 getItem: async k => values.get(k) ?? null, setItem: async (k,v) => {values.set(k,v);},
 removeItem: async k => {values.delete(k);}, clear: async () => values.clear(),
 getAllKeys: async () => [...values.keys()],
 multiGet: async keys => keys.map(k=>[k,values.get(k)??null]),
 multiSet: async pairs => pairs.forEach(([k,v])=>values.set(k,v)),
 multiRemove: async keys => keys.forEach(k=>values.delete(k)),
}; export default store;
''')
(pilot/'secureStore.js').write_text('''const values = new Map();
export const getItemAsync = async k => values.get(k) ?? null;
export const setItemAsync = async (k,v) => { values.set(k,v); };
export const deleteItemAsync = async k => { values.delete(k); };
export const isAvailableAsync = async () => true;
''')
(pilot/'fileSystem.js').write_text('''const values = new Map();
export const documentDirectory = 'memory://vitalis-pilot/';
export const cacheDirectory = 'memory://vitalis-pilot-cache/';
export const writeAsStringAsync = async (k,v) => {values.set(k,v);};
export const readAsStringAsync = async k => {if(!values.has(k))throw Error('No pilot file');return values.get(k);};
export const getInfoAsync = async k => ({exists:values.has(k),isDirectory:false});
export const deleteAsync = async k => {values.delete(k);};
export const readDirectoryAsync = async () => [...values.keys()].map(k=>k.split('/').pop());
export const makeDirectoryAsync = async () => {};
export const EncodingType = {UTF8:'utf8',Base64:'base64'};
''')
# Redirect app imports, not dependencies used by Expo itself.
for folder in ['app','components','services','utils']:
    for file in (dest/folder).rglob('*'):
        if file.suffix not in ('.js','.jsx','.ts','.tsx'):continue
        try: text=file.read_text(encoding='utf-8-sig')
        except UnicodeDecodeError: text=file.read_text(encoding='cp1252')
        import os
        rel=os.path.relpath(pilot,file.parent).replace('\\','/')
        if not rel.startswith('.'):rel='./'+rel
        for module,stub in [('@react-native-async-storage/async-storage','asyncStorage'),('expo-secure-store','secureStore'),('expo-file-system/legacy','fileSystem'),('expo-file-system','fileSystem')]:
            for quote in ["'",'"']:
                text=text.replace(quote+module+quote,quote+rel+'/'+stub+quote)
        file.write_text(text,encoding='utf-8')
(pilot/'install.js').write_text('''import * as Crypto from 'expo-crypto';
const { createFetchObserver } = require('./fetch_observer');
const original = global.fetch.bind(global);
global.fetch = createFetchObserver({fetch:original, randomBytes:n=>Crypto.getRandomBytes(n),
 serviceName:'fin-mobile-isolated',
 select:(url)=> url.startsWith('http://127.0.0.1:8362/api/inflation/')
   ? {spanName:'GET /api/inflation/'+url.split('/api/inflation/')[1].split('?')[0].replace(/personalized\\/.*/, 'personalized/{user_id}')} : null,
 emit:payload=>original('http://127.0.0.1:8370/v1/traces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(r=>{if(!r.ok)throw Error('export failed');}),
 onGap:reason=>console.warn('[VITALIS isolated capture]',reason)
});
''')
layout=dest/'app/_layout.js';layout.write_text("import '../pilot/install';\n"+layout.read_text())
(root/'artifacts/mobile-pilot/fin-source-snapshot.json').write_text(json.dumps(records,indent=2))
print('Isolated FIN prepared:',dest,'; original source files hashed:',len(records))
