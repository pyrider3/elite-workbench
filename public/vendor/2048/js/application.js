// Website bridge: the upstream rules remain unchanged. Each ranked game has a
// server-issued seed and a move log; the server independently replays the score.
(function () {
  var input, game, moves=[], requestId=0, runId=null, initialized=false;
  function send(type, extra) {
    window.parent.postMessage(Object.assign({channel:'elite-2048',type:type,requestId:requestId},extra||{}),'*');
  }
  function requestGame(){requestId++;runId=null;send('ready');}
  window.addEventListener('message',function(event){
    var data=event.data;
    if(event.source===window.parent&&data&&data.channel==='elite-2048'&&data.type==='move'&&Number.isInteger(data.direction)&&data.direction>=0&&data.direction<=3){if(input&&runId!==null)input.emit('move',data.direction);return;}
    if(event.source!==window.parent||!data||data.channel!=='elite-2048'||data.type!=='start'||data.requestId!==requestId||!Number.isInteger(data.seed))return;
    var rng=data.seed>>>0;
    Math.random=function(){rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296};
    runId=data.id;moves=[];
    if(!initialized){
      input=new KeyboardInputManager();
      var emit=input.emit;
      input.emit=function(event,direction){
        if(!game)return;
        if(event==='restart'){publish();requestGame();return;}
        if(runId===null)return;
        if(event==='move'&&Number.isInteger(direction)&&direction>=0&&direction<=3)moves.push(direction);
        if(event==='keepPlaying')moves.push(4);
        emit.call(input,event,direction);
        publish();
      };
      function Input(){return input;}
      game=new GameManager(4,Input,HTMLActuator,LocalStorageManager);
      initialized=true;
    }else{game.storageManager.clearGameState();game.actuator.continueGame();game.setup();}
    publish();
  });
  function publish(){if(game&&runId!==null)send('progress',{id:runId,moves:moves.slice(),score:game.score,over:game.over});}
  window.requestAnimationFrame(requestGame);
  window.setInterval(function(){if(runId===null)send('ready')},2000);
})();
