/** TEST ONLY: true PostgreSQL wire bytes through a fixed Docker exec relay.
 * No psql, SQL interpolation, host port, host mount, credential lookup or arbitrary
 * target. Docker pipe latency is not a production TCP/TLS measurement.
 */
import {Duplex} from 'node:stream';
import {spawn as nodeSpawn} from 'node:child_process';
export const FIXTURE_PG_RELAY = String.raw`
use strict; use warnings; use IO::Socket::INET; use IO::Select;
use Fcntl qw(F_GETFL F_SETFL O_NONBLOCK); use Errno qw(EAGAIN EWOULDBLOCK EINTR);
$SIG{PIPE}='IGNORE'; $SIG{TERM}=sub { exit 0 };
my $sock=IO::Socket::INET->new(PeerAddr=>'127.0.0.1',PeerPort=>5432,Proto=>'tcp',Timeout=>5) or exit 71;
binmode STDIN; binmode STDOUT; binmode $sock;
for my $h (\*STDIN,\*STDOUT,$sock) { my $f=fcntl($h,F_GETFL,0); defined($f) && fcntl($h,F_SETFL,$f|O_NONBLOCK) or exit 72; }
my ($to_db,$to_host)=('',''); my ($stdin_open,$db_open,$halfclosed)=(1,1,0); my $limit=65536;
while (1) {
 if (!$stdin_open && length($to_db)==0 && !$halfclosed) { shutdown($sock,1); $halfclosed=1; }
 last if !$db_open && length($to_host)==0;
 my ($rd,$wr)=(IO::Select->new(),IO::Select->new());
 $rd->add(\*STDIN) if $stdin_open && length($to_db)<$limit;
 $rd->add($sock) if $db_open && length($to_host)<$limit;
 $wr->add($sock) if $db_open && length($to_db);
 $wr->add(\*STDOUT) if length($to_host);
 my ($r,$w)=IO::Select->select($rd,$wr,undef,1); next unless defined $r;
 for my $h (@$r) {
  my $from_host=fileno($h)==fileno(STDIN); my $target=$from_host?\$to_db:\$to_host;
  my $take=$limit-length($$target); $take=16384 if $take>16384;
  my $n=sysread($h,my $chunk,$take);
  if (!defined $n) { next if $!==EAGAIN || $!==EWOULDBLOCK || $!==EINTR; exit 73; }
  if (!$n) { if ($from_host) {$stdin_open=0} else {$db_open=0;$stdin_open=0;$to_db=''}; next; }
  $$target.=$chunk;
 }
 for my $h (@$w) {
  my $target=fileno($h)==fileno(STDOUT)?\$to_host:\$to_db;
  next unless length $$target;
  my $n=syswrite($h,$$target);
  if (!defined $n) { next if $!==EAGAIN || $!==EWOULDBLOCK || $!==EINTR; exit 74; }
  exit 75 unless $n; substr($$target,0,$n,'');
 }
}
close $sock; exit 0;
`;
const failure=()=>Object.assign(new Error('SYNTHETIC_PG_WIRE_TRANSPORT_FAILED'),{code:'SYNTHETIC_PG_WIRE_TRANSPORT_FAILED'});
export function createFixturePgWireStream({container,spawnProcess=nodeSpawn,onChild}={}) {
 if(typeof container!=='string'||!/^design-workflow-synthetic-[0-9]+-[a-f0-9]{8}$/.test(container)||typeof spawnProcess!=='function')throw failure();
 let child=null,started=false,closed=false,writeEnded=false,finalizing=false,killTimer=null,hardTimer=null,finishDestroy=null;
 let resolveCompletion,rejectCompletion; const completion=new Promise((r,j)=>{resolveCompletion=r;rejectCompletion=j;});void completion.catch(()=>{});
 const socket=new Duplex({allowHalfOpen:false,readableHighWaterMark:65536,writableHighWaterMark:65536,
  read(){child?.stdout.resume();},
  write(chunk,encoding,callback){if(!child||closed||!Buffer.isBuffer(chunk)){callback(failure());return;}child.stdin.write(chunk,callback);},
  final(callback){writeEnded=true;if(!child||closed){callback();return;}child.stdin.end(callback);},
  destroy(error,callback){
   finalizing=true;
   if(!child||closed){resolveCompletion();callback(error);return;}
   finishDestroy=()=>{clearTimeout(killTimer);clearTimeout(hardTimer);callback(error);};
   child.stdin.destroy();child.kill('SIGTERM');
   killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},1000);
   hardTimer=setTimeout(()=>{if(!closed){rejectCompletion(failure());const done=finishDestroy;finishDestroy=null;if(done)callback(failure());}},3000);
  }
 });
 socket.on('error',()=>{}); // pg receives the same event; shutdown cannot be unhandled.
 socket.setNoDelay=()=>socket; socket.setKeepAlive=()=>socket;
 socket.ref=()=>{child?.ref?.();return socket;}; socket.unref=()=>{child?.unref?.();return socket;};
 socket.connect=(port,host)=>{
  if(started||port!==5432||host!=='127.0.0.1'){queueMicrotask(()=>socket.destroy(failure()));return socket;}started=true;
  try{child=spawnProcess('docker',['exec','-i',container,'perl','-e',FIXTURE_PG_RELAY],{stdio:['pipe','pipe','pipe']});}
  catch{socket.destroy(failure());return socket;}
  try{onChild?.(child,completion);}catch{socket.destroy(failure());}
  child.stdout.on('data',bytes=>{if(!socket.push(bytes))child.stdout.pause();});
  child.stdout.on('end',()=>socket.push(null));
  child.stdout.on('error',()=>socket.destroy(failure()));
  child.stdin.on('error',()=>{if(!finalizing)socket.destroy(failure());});
  child.stderr.resume(); // never disclose helper stderr, SQL, parameters or data.
  child.on('error',()=>socket.destroy(failure()));
  child.once('spawn',()=>{if(!socket.destroyed)socket.emit('connect');});
  child.once('close',(code)=>{
   closed=true;clearTimeout(killTimer);clearTimeout(hardTimer);resolveCompletion();
   if(finishDestroy){const done=finishDestroy;finishDestroy=null;done();}
   else if(code!==0||!writeEnded)socket.destroy(failure());
   else if(!socket.destroyed)socket.destroy();
  });
  return socket;
 };
 Object.defineProperty(socket,'fixtureClosed',{value:completion});
 return socket;
}
