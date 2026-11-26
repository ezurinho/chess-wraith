const fs=require('fs'),vm=require('vm'),path=require('path');
const {JSDOM}=require('jsdom');
const ROOT='C:\\Users\\Administrator\\.deepai-code\\projects\\userscripts\\chess-wraith';
const read=(r)=>fs.readFileSync(path.join(ROOT,'src',r),'utf8');
const html='<wc-chess-board class="board"></wc-chess-board>' +
'<div class="player-component player-top"><div class="user-tagline-component"><span class="user-tagline-rating">(113)</span></div></div>' +
'<div class="player-component player-bottom"><span class="user-tagline-rating">(133)</span></div>';
const dom=new JSDOM('<!doctype html><body>'+html+'</body>',{url:'https://www.chess.com/play/online'});
const {window}=dom;
window.Element.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:0,height:0,right:0,bottom:0,x:0,y:0};};
const ctx=vm.createContext({window,document:window.document,Element:window.Element,Node:window.Node,getComputedStyle:window.getComputedStyle.bind(window),console,Math,Date,JSON});
const src=read('10-config.js')+String.fromCharCode(10)+read('20-utils.js')+String.fromCharCode(10)+read('30-chess.js')+String.fromCharCode(10)+read('35-chess-glue.js')+String.fromCharCode(10)+read('40-board.js')+String.fromCharCode(10)+';globalThis.__t={ratingNodes,readBoardRatings,ratingBand,readOpponentRating};';
vm.runInContext(src,ctx,{filename:'x.js'});
const api=vm.runInContext('globalThis.__t',ctx);
console.log('body', window.document.body.innerHTML);
console.log('sel', window.document.querySelectorAll('.user-tagline-rating').length);
console.log(JSON.stringify(api.ratingNodes().map(n=>({r:n.rating,b:n.band,t:n.el.textContent})),null,1));
console.log(JSON.stringify(api.readBoardRatings()));
console.log(api.readOpponentRating('w',false));