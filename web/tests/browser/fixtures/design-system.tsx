import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialog } from "../../../src/shared/ui/ConfirmDialog/ConfirmDialog";
import { Button } from "../../../src/shared/ui/Button/Button";
import { TextField } from "../../../src/shared/ui/TextField/TextField";
import { Checkbox } from "../../../src/shared/ui/Checkbox/Checkbox";
import { Panel } from "../../../src/shared/ui/Panel/Panel";
import "@fontsource/ibm-plex-sans/cyrillic-400.css";
import "@fontsource/ibm-plex-sans/cyrillic-500.css";
import "@fontsource/ibm-plex-sans/cyrillic-600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "../../../src/styles.css";

function Components() {
  const [clicks, setClicks] = useState(0);
  const [submits, setSubmits] = useState(0);
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);
  return <Panel role="region" aria-label="Основные элементы" className="fixture-panel" data-testid="panel">
    <h2>Базовые компоненты</h2>
    <div>
      <Button aria-pressed={clicks > 0} className="fixture-button" onClick={() => setClicks(n => n + 1)}>Обычная</Button>
      <Button variant="primary">Основная</Button>
      <Button variant="ghost">Без фона</Button>
      <Button variant="danger">Опасная</Button>
      <Button disabled onClick={() => setClicks(n => n + 1)}>Недоступная</Button>
    </div>
    <form onSubmit={e => {e.preventDefault(); setSubmits(n => n + 1);}}>
      <TextField label="Имя" id="name-field" name="name" placeholder="Имя персонажа" required value={name} onChange={e => setName(e.target.value)} ref={inputRef} />
      <span id="field-hint">Подсказка поля</span>
      <TextField label="Проверка" error="Введите значение" aria-describedby="field-hint" />
      <TextField label="Недоступное поле" disabled defaultValue="Нельзя изменить" />
      <Checkbox label="Сетка" checked={checked} onChange={e => setChecked(e.target.checked)} ref={checkboxRef} />
      <Checkbox label="Недоступный выбор" disabled defaultChecked />
      <Button onClick={() => setClicks(n => n + 1)}>Без отправки</Button>
      <Button variant="primary" type="submit">Отправить</Button>
      <Button onClick={() => inputRef.current?.focus()}>Фокус на имя</Button>
      <Button onClick={() => checkboxRef.current?.focus()}>Фокус на чекбокс</Button>
    </form>
    <output data-testid="state" data-clicks={clicks} data-submits={submits} data-checked={checked} data-name={name} />
  </Panel>;
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [confirmed, setConfirmed] = useState(0);
  const [cancelled, setCancelled] = useState(0);
  return <>
    {open ? <ConfirmDialog title="Удалить «Страж»?" text={<p>Это нельзя отменить.</p>} confirmLabel="Удалить" danger={new URLSearchParams(location.search).get("variant") !== "primary"}
      onConfirm={() => {setConfirmed(n => n + 1); setOpen(false);}}
      onCancel={() => {setCancelled(n => n + 1); setOpen(false);}} /> : <button onClick={() => setOpen(true)}>Открыть подтверждение</button>}
    <output hidden data-confirmed={confirmed} data-cancelled={cancelled} />
  </>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  {new URLSearchParams(location.search).get("mode") === "components" ? <Components /> : <Fixture />}
</React.StrictMode>);
