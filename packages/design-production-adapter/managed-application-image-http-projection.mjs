/** Exact browser DTO only; no object locator or private proof is projected. */
import {policyCopy} from './approval-attempt-contracts.mjs';
import {checkedApplicationImageStatus} from '../design-prepared-ui/application-images.mjs';
export function validateManagedApplicationImageProjection(value,expected={}){return checkedApplicationImageStatus(policyCopy(value),expected);}
