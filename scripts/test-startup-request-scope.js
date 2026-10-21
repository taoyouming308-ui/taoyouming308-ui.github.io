// Executes the actual read callbacks with synthetic delayed promises; no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync('perm-app.html','utf8');
const slice=(a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const values=new Map(),requests=[],renders=[],elements={'booking-list':{innerHTML:''},'hair-booking-picker-list':{innerHTML:''}};
const c={window:{},document:{getElementById:id=>elements[id]},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},AUTHENTICATED_STAFF:{session_token:'a',store:'A',username:'staff'},BOOKING_SHOP:'A',BOOKING_BARBER:'staff',BOOKING_DATE:'2026-10-01',BOOKINGS_CACHE:[],bookingReadGeneration:0,hairPickerReadGeneration:0,employeeBookingsApi:(op,payload)=>{assert.equal(op,'today_bookings');return new Promise((resolve,reject)=>requests.push({payload,resolve,reject}));},renderBookings:r=>renders.push(r),isVisibleCustomerBooking:()=>true,clearBookingSession:()=>{c.AUTHENTICATED_STAFF=null;},showIdentityModal:()=>{},getLocalDateStr:()=>c.BOOKING_DATE,esc:String,escAttr:String};
vm.createContext(c);vm.runInContext(slice('  function verifiedEmployeeSession()','  var bookingReadGeneration')+slice('  function isEmployeeSessionInvalid(','  function employeeBookingsApi(')+slice('  function loadBookings(','  function isVisibleCustomerBooking(')+slice('  window.loadHairBookingPickerDate =','  window.pickBookingCustomerFromNode'),c);
function identity(token,store='A'){c.AUTHENTICATED_STAFF={session_token:token,store,username:'staff'};values.set('booking-session',JSON.stringify(c.AUTHENTICATED_STAFF));c.BOOKING_SHOP=store;}
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 identity('a');c.loadBookings(true);c.BOOKING_DATE='2026-10-02';c.loadBookings(true);
 requests[1].resolve({rows:[{id:'new',barber_name:'staff'}]});await flush();requests[0].resolve({rows:[{id:'old',barber_name:'staff'}]});await flush();assert.equal(renders.length,1);assert.equal(renders[0][0].id,'new');assert.equal(values.has('bookings_cache_A_2026-10-01_staff'),false);
 c.loadBookings(true);identity('b','B');requests[2].reject(Object.assign(new Error('登录已过期，请重新登录'),{status:403}));await flush();assert.equal(c.AUTHENTICATED_STAFF.session_token,'b');
 c.loadBookings(true);const beforeRemoval=renders.length;values.delete('booking-session');requests[3].resolve({rows:[{id:'leak',barber_name:'staff'}]});await flush();assert.equal(renders.length,beforeRemoval);assert.equal(c.verifiedEmployeeSession(),null);c.loadBookings();assert.equal(requests.length,4);
 identity('c');c.window.loadHairBookingPickerDate('2026-10-01');c.window.loadHairBookingPickerDate('2026-10-02');requests[5].resolve({rows:[{id:'new',customer_name:'new',barber_name:'staff'}]});await flush();const current=elements['hair-booking-picker-list'].innerHTML;requests[4].resolve({rows:[{id:'old',customer_name:'old',barber_name:'staff'}]});await flush();assert.equal(elements['hair-booking-picker-list'].innerHTML,current);assert.match(current,/new/);
 c.window.loadHairBookingPickerDate('2026-10-03');identity('d','D');requests[6].reject(Object.assign(new Error('账号已停用'),{status:403}));await flush();assert.equal(c.AUTHENTICATED_STAFF.session_token,'d');assert.doesNotMatch(elements['hair-booking-picker-list'].innerHTML,/失败/);
 console.log('startup request scope passed: date race, stale expiry/new identity, cross-tab token removal, picker date/identity race; no writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
