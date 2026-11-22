/** Key-settings-only composition. No listener, issuer, secrets or enabled default. */
import {createPostgresImmutableKeyRepository} from './postgres-immutable-key-repository.mjs';
import {createImmutablePreparedDesignKeySettings} from './key-settings.mjs';
import {createImmutableDesignKeySealer} from './key-crypto.mjs';
import {createDesignHttpHandler} from './http-handler.mjs';

const paths=new Set(['/api/design/key-settings/read','/api/design/key-settings/save','/api/design/key-settings/revoke']);
export function createImmutableKeySettingsRuntime({enabled=false,publicOrigin,allowedRequestOrigins,
 acquireClient,secretProvider,cryptoProvider,approvedModels=[],allowASR=false,
 // Injected repositories are trusted server configuration, never request content.
 repository}={}){
 if(enabled!==true)return Object.freeze({handle:createDesignHttpHandler()});
 const store=repository??createPostgresImmutableKeyRepository({enabled:true,acquireClient});
 const sealer=createImmutableDesignKeySealer({secretProvider,cryptoProvider});
 const settings=createImmutablePreparedDesignKeySettings({enabled:true,repository:store,
  resolveIdentity:store.resolveIdentity,sealer,approvedModels,allowASR});
 const inner=createDesignHttpHandler({enabled:true,publicOrigin,allowedRequestOrigins,
  keySettings:settings,keySettingsSchema:'immutable-v2',
  employeeAdapter:{authenticate:credential=>store.resolveIdentity({credential}),gate:Object.freeze({})}});
 return Object.freeze({async handle(request){
  let path;try{path=new URL(request.url).pathname;}catch{}
  if(!paths.has(path))return new Response(JSON.stringify({ok:false,error:'IMMUTABLE_KEY_ROUTE_ONLY'}),{status:404,
   headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  return inner(request);
 }});
}
