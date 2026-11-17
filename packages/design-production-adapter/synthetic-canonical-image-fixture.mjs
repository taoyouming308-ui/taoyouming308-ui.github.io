/** Literal synthetic RGB8 four-color source; no user images. Changing bytes requires a new fixture ID/policy. */
export const SYNTHETIC_CANONICAL_FIXTURE=Object.freeze({id:'rgb8-four-colors-80x120-v1',version:'1',sha256:'50971139e6b50ec254768e3dc7c6490002745d245a7e5c06eb98e9f22a73950f',byteLength:219,width:80,height:120,mime:'image/png'});
const bytes='iVBORw0KGgoAAAANSUhEUgAAAFAAAAB4CAIAAADqjOKhAAAAoklEQVR4nO3PsQ0AQQzDsOy/dH6Da4VHCKi3OTuT1KyG9Q+AgYGBgYGBz9Q/AAYGBgYGBj5T/wAYGBgYGBj4TP0DYGBgYGBg4DP1D4CBgYGBgYHP1D8ABgYGBgYGPlP/ABgY+Jfganl3koCBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGffccUs9MLv8cCAAAAAElFTkSuQmCC';
export const syntheticCanonicalSourceBytes=()=>Buffer.from(bytes,'base64');
