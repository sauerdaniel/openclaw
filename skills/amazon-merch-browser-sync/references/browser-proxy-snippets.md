# Browser Proxy Snippets (Mac Merch Pull)

## List tabs

```bash
openclaw nodes invoke --node "Daniel’s Mac mini" --command browser.proxy --params '{
  "path":"/tabs",
  "method":"GET",
  "profile":"openclaw"
}' --json
```

## Navigate target tab to Merch analyze page

```bash
openclaw nodes invoke --node "Daniel’s Mac mini" --command browser.proxy --params '{
  "path":"/navigate",
  "method":"POST",
  "profile":"openclaw",
  "body":{
    "targetId":"<TARGET_ID>",
    "url":"https://merch.amazon.com/analyze/products"
  }
}' --json
```

## Set a single day (example 3/10/26) and click Go

```json
{
  "kind": "evaluate",
  "targetId": "<TARGET_ID>",
  "fn": "() => { const inputs=[...document.querySelectorAll('input[ngbdatepicker]')]; if(inputs.length<2) return {ok:false,count:inputs.length}; const set=(el,val)=>{el.removeAttribute('readonly'); el.focus(); el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.blur();}; set(inputs[0],'3/10/26'); set(inputs[1],'3/10/26'); const go=[...document.querySelectorAll('button')].find(b=>b.textContent&&b.textContent.trim()==='Go'); if(go) go.click(); return {ok:true,values:[inputs[0].value,inputs[1].value],clicked:!!go}; }"
}
```

Call with `/act` + `POST` in `browser.proxy`.

## Wait

```json
{
  "kind": "wait",
  "targetId": "<TARGET_ID>",
  "timeMs": 2000
}
```

## Extract date range + USD purchased/royalties

```json
{
  "kind": "evaluate",
  "targetId": "<TARGET_ID>",
  "fn": "() => { const t=document.body.innerText; const rm=t.match(/DATE RANGE:([^\\n]+)/); const m=t.match(/USD\\s+(\\d+)\\s+Purchased\\s+USD\\s+([0-9.,]+)\\s+Estimated Royalties/); return { range: rm?rm[1].trim(): null, purchased: m?Number(m[1]): null, royalties: m?Number(m[2].replace(/,/g,'')): null }; }"
}
```

## Recommended reporting format

- `YYYY-MM-DD | purchased=<n> | royalties=$<x.xx> | source=browser-fresh`
- Include weekly sum when requested.
