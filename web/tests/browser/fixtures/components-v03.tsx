import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Tabs } from "../../../src/shared/ui/Tabs/Tabs";
import { Dialog, type DialogProps } from "../../../src/shared/ui/Dialog/Dialog";
import { Tooltip } from "../../../src/shared/ui/Tooltip/Tooltip";
import { Select } from "../../../src/shared/ui/Select/Select";
import { Button } from "../../../src/shared/ui/Button/Button";
import "@fontsource/ibm-plex-sans/cyrillic-400.css";
import "@fontsource/ibm-plex-sans/cyrillic-500.css";
import "@fontsource/ibm-plex-sans/cyrillic-600.css";
import "../../../src/styles.css";
import "./components-v03.css";

function Draft() { const [value, setValue] = useState(""); return <textarea aria-label="Черновик" value={value} onChange={e => setValue(e.target.value)} />; }
function Fixture() {
  const [tab, setTab] = useState("chat"), [gm, setGm] = useState(true), [disabled, setDisabled] = useState(false);
  const [open, setOpen] = useState(false), [kind, setKind] = useState<DialogProps["kind"]>("danger");
  const [long, setLong] = useState(false), [pending, setPending] = useState(false), [calls, setCalls] = useState(0);
  const [outcome, setOutcome] = useState("success");
  const deferred = useRef<{ resolve: () => void; reject: (error: Error) => void }>();
  const [selected, setSelected] = useState(""), [loading, setLoading] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  return <main className="v03-fixture">
    <h1>Компоненты v0.3</h1>
    <section aria-label="Tabs demo" className="v03-tabs-demo">
      <label><input type="checkbox" checked={gm} onChange={e => setGm(e.target.checked)} />GM</label>
      <label><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} />Отключить вкладки</label>
      <Tabs aria-label="Панели" value={tab} onValueChange={setTab} disabled={disabled} size={new URLSearchParams(location.search).has("regular") ? "regular" : "compact"} items={[
        {value:"chat",label:"Чат",content:<Draft />},
        {value:"characters",label:"Персонажи",content:<input aria-label="Поиск персонажа" />},
        {value:"disabled",label:"Недоступная",content:"Нельзя открыть",disabled:true},
        {value:"scenes",label:"Сцены",content:"Сцены",hidden:!gm},
        {value:"players",label:"Игроки",content:"Игроки",hidden:!gm},
      ]} />
    </section>
    <section aria-label="Dialog demo">
      <label>Тип<select aria-label="Тип диалога" value={kind} onChange={e => setKind(e.target.value as DialogProps["kind"])}><option value="danger">danger</option><option value="confirmation">confirmation</option><option value="information">information</option></select></label>
      <label><input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} />Длинное описание</label>
      <label>Результат<select aria-label="Результат" value={outcome} onChange={e => setOutcome(e.target.value)}><option>success</option><option>error</option><option>deferred</option></select></label>
      <Button onClick={() => setOpen(true)}>Открыть Dialog</Button>
      <Dialog open={open} kind={kind} title="Подтвердить действие?" description={long ? <>{Array.from({length:50},(_,i)=><p key={i}>Длинное описание действия с сохранением доступных кнопок. {i}</p>)}</> : "Это действие нельзя отменить."}
        confirmLabel={kind === "information" ? "Понятно" : "Подтвердить"} pending={pending} onClose={() => setOpen(false)} onConfirm={async () => {
          setCalls(n => n+1);
          if(outcome === "error") throw new Error("Не удалось сохранить. Повторите попытку.");
          if(outcome === "deferred") {setPending(true);try {await new Promise<void>((resolve,reject)=>{deferred.current={resolve,reject};});} finally {setPending(false);} }
          setOpen(false);
        }} />
      <output data-testid="dialog-state" data-calls={calls} data-pending={pending} />
      {/* Test control represents an external async operation; background is inert in modal. */}
      <button hidden id="resolve-operation" onClick={()=>deferred.current?.resolve()}>Resolve</button>
      <button hidden id="reject-operation" onClick={()=>deferred.current?.reject(new Error("Ошибка операции"))}>Reject</button>
    </section>
    <section aria-label="Tooltip demo">
      <p id="existing-hint">Обычная инструкция</p>
      {(["top","bottom","left","right"] as const).map(placement => <Tooltip key={placement} placement={placement} content={`Подсказка ${placement}`}><Button aria-describedby="existing-hint">{placement}</Button></Tooltip>)}
      <div className="v03-edge"><Tooltip placement="right" content={"Длинная подсказка у границы экрана. ".repeat(10)}><Button>У края</Button></Tooltip></div>
    </section>
    <section aria-label="Select demo">
      <Select ref={selectRef} label="Режим" value={selected} onChange={e => setSelected(e.target.value)} placeholder="Выберите режим" options={[{value:"view",label:"Просмотр"},{value:"blocked",label:"Недоступно",disabled:true},{value:"edit",label:"Редактирование"}]} />
      <Select label="Недоступный режим" disabled value="view" options={[{value:"view",label:"Просмотр"}]} />
      <Select label="Ошибка выбора" error="Выберите доступный режим" aria-describedby="select-hint" options={[{value:"view",label:"Просмотр"}]} />
      <span id="select-hint">Инструкция выбора</span>
      <Select label="Загружаемый режим" loading={loading} placeholder="Загрузка режимов" value="" options={[]} />
      <Button onClick={()=>setLoading(value=>!value)}>Переключить загрузку</Button>
      <Button onClick={()=>selectRef.current?.focus()}>Фокус на select</Button>
      <output data-testid="selected">{selected}</output>
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Fixture /></React.StrictMode>);
