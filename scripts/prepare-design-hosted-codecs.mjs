/** Deterministic CJS -> ESM export shim; no codec algorithm changes. Pinned
 * upstream files/licenses remain alongside generated modules for audit/relink. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../packages/design-production-adapter/vendor/',import.meta.url),manifest=JSON.parse(await readFile(new URL('codec-provenance.json',root),'utf8'));
for(const file of manifest.files){
 assert.match(file.path,/^[a-zA-Z0-9.-]+$/);
 assert.equal(createHash('sha256').update(await readFile(new URL(file.path,root))).digest('hex'),file.sha256,'Pinned dependency differs: '+file.path);
}
for(const [kind,fn]of [['encoder','encode'],['decoder','decode']]){
 const name=`jpeg-${kind}-0.4.4.cjs`,source=await readFile(new URL(name,root),'utf8');
 assert.equal(createHash('sha256').update(source).digest('hex'),manifest.files.find(f=>f.path===name).sha256);
 const block=`if (typeof module !== 'undefined') {\n\tmodule.exports = ${fn};\n} else if (typeof window !== 'undefined') {\n\twindow['jpeg-js'] = window['jpeg-js'] || {};\n\twindow['jpeg-js'].${fn} = ${fn};\n}`;
 assert.equal(source.split(block).length,2);
 const generated="// Generated ESM shim; see prepare-design-hosted-codecs.mjs.\nimport {Buffer} from 'node:buffer';\n"+source.replace(block,`export default ${fn};`),target=name.replace('.cjs','.mjs');
 if(process.argv.includes('--write'))await writeFile(new URL(target,root),generated);
 else assert.equal(await readFile(new URL(target,root),'utf8'),generated);
}
console.log('Pinned JPEG ESM shims verified');
