/** Read-only explicit host probe; never loads application credentials. */
import {qualifyPhoneNativeHost} from '../packages/design-production-adapter/phone-native-driver.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--image'||!/^sha256:[a-f0-9]{64}$/.test(args[1])){
 console.error('Usage: node scripts/preflight-design-phone-host.mjs --image sha256:<64 lowercase hex>');process.exitCode=2;
}else{
 try{const host=await qualifyPhoneNativeHost({image:args[1]});console.log(JSON.stringify({ok:true,platform:host.platform,architecture:host.architecture,rootless:host.rootless,cgroupVersion:host.cgroupVersion,image:host.image,targetEnforcementAccepted:false}));}
 catch{console.log(JSON.stringify({ok:false,code:'PHONE_NATIVE_HOST_UNSUPPORTED',targetEnforcementAccepted:false}));process.exitCode=1;}
}
