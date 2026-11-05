// Shared footer helpers: reveal the contact e-mail and keep the copyright end year current.
(function(){
  function run(){
    var e='info'+'@'+'swissnewbie'+'.ch';
    document.querySelectorAll('.site-footer .sn-email-reveal').forEach(function(s){
      var a=document.createElement('a');a.href='mailto:'+e;a.textContent=e;s.parentNode.replaceChild(a,s);
    });
    var y=String(new Date().getFullYear());
    document.querySelectorAll('.sn-copy-year').forEach(function(n){n.textContent=y;});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
