/* 화면 모드(어두운 / 밝은) 시간 자동 전환 — 모든 페이지의 <head> 맨 앞에서 그리기 전에 실행 (깜빡임 방지)
 *  · 기본: 낮 7시 ~ 저녁 7시 밝게, 그 밖에는 어둡게 (기기 시간대 기준)
 *  · 단추로 직접 고르면 "다음 전환 시각"(아침 7시 / 저녁 7시)까지만 유지되고 그 뒤에는 다시 자동
 *  · 페이지를 연 채로 두어도 1분마다 · 화면으로 돌아올 때 확인해서 바꿉니다
 *  window.PHThemeMode = { light(), until(), auto(), setManual(t), setAuto() }
 *  저장: ph.theme(마지막 모양) · ph.themeMode('manual') · ph.themeUntil(만료 시각 ms) */
const THEME_BOOT = `(function(){try{var d=document.documentElement,ls=localStorage,DAY=7,NIGHT=19;
function until(){var n=new Date(),h=n.getHours(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate(),h<DAY?DAY:(h<NIGHT?NIGHT:DAY+24),0,0,0);return t.getTime()}
function manual(){if(ls.getItem('ph.themeMode')!=='manual')return false;if(Date.now()<(+ls.getItem('ph.themeUntil')||0))return true;ls.removeItem('ph.themeMode');ls.removeItem('ph.themeUntil');return false}
function L(){if(manual())return ls.getItem('ph.theme')==='light';var h=new Date().getHours();return h>=DAY&&h<NIGHT}
function put(l){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',l?'#D6EDE3':'#0D1A19')}
function ap(){var l=L();if((d.getAttribute('data-theme')==='light')!==l){d.setAttribute('data-theme',l?'light':'dark');put(l);try{window.dispatchEvent(new CustomEvent('ph-theme-auto',{detail:{theme:l?'light':'dark'}}))}catch(e){}}}
d.setAttribute('data-theme',L()?'light':'dark');
window.PHThemeMode={light:L,until:until,auto:function(){return !manual()},
setManual:function(t){ls.setItem('ph.theme',t==='light'?'light':'dark');ls.setItem('ph.themeMode','manual');ls.setItem('ph.themeUntil',String(until()))},
setAuto:function(){ls.removeItem('ph.themeMode');ls.removeItem('ph.themeUntil');ap()}};
setInterval(ap,60000);document.addEventListener('visibilitychange',function(){if(!document.hidden)ap()})}catch(e){}})();`;
module.exports = { THEME_BOOT };
