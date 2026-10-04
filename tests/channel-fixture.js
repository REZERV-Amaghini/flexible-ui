(() => {
  let fail=false,slow=false;
  const load=(url,{signal})=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>fail?reject(new Error('Fixture failure')):resolve({url,name:url.split('/').at(-1).slice(1)+' のチャンネル',handle:url.split('/').at(-1),avatar:'',stats:['登録者数 1.2万人','24本の動画'],
      description:'これはオリジナルのテストデータです。外部の動画やアカウント情報は使っていません。\n'+ '概要の折り返しと長い文章の表示を確認できます。'.repeat(8),videos:Array.from({length:4},(_,i)=>({id:'abcdefghij'+i,title:'動画カード '+(i+1)+' · 長いタイトルが2行に収まることを確認します',thumbnail:'',duration:'3:40',views:'1.2万回視聴'}))}),slow?1500:60);
    signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
  });
  const instance=FlexibleChannelCard.create({stage:true,load});
  window.channelCardFixture={instance};
  document.querySelector('#light').onclick=()=>document.documentElement.toggleAttribute('dark');
  document.querySelector('#slow').onclick=()=>{slow=!slow;document.querySelector('#slow').textContent=slow?'遅い応答を解除':'遅い応答を試す';};
  document.querySelector('#failure').onclick=()=>{fail=!fail;document.querySelector('#failure').textContent=fail?'取得失敗を解除':'取得失敗を試す';};
  document.querySelector('#results').textContent='名前、返信、ライブチャット、ライトモード、遅い応答、取得失敗を確認できます。';
})();
