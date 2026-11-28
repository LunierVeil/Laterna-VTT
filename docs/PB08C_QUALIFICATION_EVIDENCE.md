# Журнал квалификации PB-08C

Проверяемый коммит — `ce2b2dd5a595f63d6268a539ed569737d7279e3f`.
Исходники runtime совпадают с принятым архитектурным HEAD
`525f2db65b14660455682ca96e3598c4f887e094`. Матрица выполнена 28 ноября
2026 года на Ubuntu 24.04.5 LTS в QEMU 11.1.3 с KVM. Диск гостя и тестовые
диски подключены через virtio с `cache=none`. ext4 использовал корневой диск,
Btrfs и XFS использовали отдельные локальные виртуальные диски. Условия и
команды сценария приведены в [протоколе приёмки](PB08C_OFFLINE_ACTIVATION.md#воспроизводимая-приёмка).

| Файловая система | Штатная перезагрузка | Жёсткое выключение ВМ |
| --- | ---: | ---: |
| ext4 | 11/11 | 11/11 |
| Btrfs | 11/11 | 11/11 |
| XFS | 11/11 | 11/11 |

Штатная перезагрузка выполнялась командой `systemctl reboot` внутри гостя.
Для жёсткого выключения хост использовал QMP `stop` и затем `quit`, после
чего загрузил тот же диск заново. Гостевой shutdown в этой серии не
вызывался. Это отключение ВМ при работающем хосте. Результаты отдельной серии
с завершением процесса backend в таблицу не входят.

Сигнал `confirmed-write` появляется сразу после `await session.commit()`,
пока сессия и lifespan работают. Отдельная проверка попыткой получить
исключительный lease до выключения подтвердила, что backend продолжает
удерживать общий lease. После каждой остановки проверялись смена boot ID,
явный PASS harness и инварианты для соответствующей точки. В активной цели
проверялись подтверждённая запись, UUID, сцены, листы, хеши медиа и ключа ГМ.
Сценарии также проверяли отказ запуска Alpha и пустого DataHome.

Первый XFS-диск был создан с включёнными по умолчанию возможностями
`exchange` и `parent`, которые ядро гостя не смогло смонтировать. Матрица
XFS прошла на заново размеченном синтетическом диске с
`mkfs.xfs -i exchange=0 -n parent=0`.

[Fast CI](https://github.com/LunierVeil/Laterna-VTT/actions/runs/46089360300)
и [Windows candidate с publish=false](https://github.com/LunierVeil/Laterna-VTT/actions/runs/46089535576)
на том же SHA. Hosted Windows подтверждает Profile и Portable под обычной
учётной записью. Для reboot и hard power-off NTFS требуется отдельный журнал
из управляемого гостя.

## Строки журнала Linux

Колонки — ФС, способ остановки, контрольная точка, boot ID до, boot ID после,
результат. Журнал содержит только синтетические сценарии.

```text
ext4	reboot	before-source-fence	47e11a5e-739a-420e-afae-322bab5adb24	e4e7c3d7-289c-4b10-9485-8faf5c02f274	PASS
ext4	reboot	after-source-fence	e4e7c3d7-289c-4b10-9485-8faf5c02f274	3683c9cb-e927-4265-a38d-1a31cdbdc031	PASS
ext4	reboot	staging	3683c9cb-e927-4265-a38d-1a31cdbdc031	061ce1cd-d975-4d35-b582-96fa819a1819	PASS
ext4	reboot	before-target-publish	061ce1cd-d975-4d35-b582-96fa819a1819	ab5aa38c-d2e7-48ff-9101-e50c2d4ab525	PASS
ext4	reboot	after-target-publish	ab5aa38c-d2e7-48ff-9101-e50c2d4ab525	030a5c7d-1d00-438b-95f4-54b9c5502e3a	PASS
ext4	reboot	activation	030a5c7d-1d00-438b-95f4-54b9c5502e3a	d4f9bc97-22a9-4d1f-bb73-2b46aabfe3fc	PASS
ext4	reboot	after-activation	d4f9bc97-22a9-4d1f-bb73-2b46aabfe3fc	d4be933d-7402-4345-bdda-c4f22ac20f94	PASS
ext4	reboot	confirmed-write	d4be933d-7402-4345-bdda-c4f22ac20f94	0b1f0cd3-e20f-41bc-b11f-30004255f0de	PASS
ext4	reboot	sqlite-rollback	0b1f0cd3-e20f-41bc-b11f-30004255f0de	21ada39b-3809-4d3f-9c1c-8ef251a2f69b	PASS
ext4	reboot	sqlite-wal	21ada39b-3809-4d3f-9c1c-8ef251a2f69b	e96a08a4-8a38-4588-88a5-41004bab1bfc	PASS
ext4	reboot	recovery	e96a08a4-8a38-4588-88a5-41004bab1bfc	484f6e2b-b5ed-4b80-870e-b3deff5cc420	PASS
ext4	hard-power-off	before-source-fence	484f6e2b-b5ed-4b80-870e-b3deff5cc420	a1b88b8c-9f6d-4752-8ff0-eeda55c8fbbe	PASS
ext4	hard-power-off	after-source-fence	a1b88b8c-9f6d-4752-8ff0-eeda55c8fbbe	016b8fad-9a7d-4456-b39c-9145f30cea00	PASS
ext4	hard-power-off	staging	016b8fad-9a7d-4456-b39c-9145f30cea00	012e5688-d64b-4e5e-85af-d899929bbe56	PASS
ext4	hard-power-off	before-target-publish	012e5688-d64b-4e5e-85af-d899929bbe56	9b107d34-8626-4d5b-904b-9dec33cad115	PASS
ext4	hard-power-off	after-target-publish	9b107d34-8626-4d5b-904b-9dec33cad115	4dbdb8a7-ed0b-4ee0-9345-d0bfe0c56296	PASS
ext4	hard-power-off	activation	4dbdb8a7-ed0b-4ee0-9345-d0bfe0c56296	00382b1a-8eab-4207-95f3-22b2b2f4bf04	PASS
ext4	hard-power-off	after-activation	00382b1a-8eab-4207-95f3-22b2b2f4bf04	4540ae96-014f-452a-89eb-b00696b44104	PASS
ext4	hard-power-off	confirmed-write	4540ae96-014f-452a-89eb-b00696b44104	80ac4b08-6fa1-4028-88e1-065501af6cc6	PASS
ext4	hard-power-off	sqlite-rollback	80ac4b08-6fa1-4028-88e1-065501af6cc6	80223a08-5002-4f78-ab56-4c0b8de3f26f	PASS
ext4	hard-power-off	sqlite-wal	80223a08-5002-4f78-ab56-4c0b8de3f26f	bcd37bdc-0b98-4a49-a150-f817ef4d0d04	PASS
ext4	hard-power-off	recovery	bcd37bdc-0b98-4a49-a150-f817ef4d0d04	cf623b2c-d358-48c6-8870-84e2cd33ab69	PASS
btrfs	reboot	before-source-fence	eb50b9ad-d56d-40b8-ae15-b72cbb80b1aa	09e63d63-9c82-4392-ac2b-3b9d41bf27f7	PASS
btrfs	reboot	after-source-fence	09e63d63-9c82-4392-ac2b-3b9d41bf27f7	709c4c0e-00cc-43e1-badd-aabaff692c55	PASS
btrfs	reboot	staging	709c4c0e-00cc-43e1-badd-aabaff692c55	4ebc2b48-60b6-429b-a5f0-8d7025576200	PASS
btrfs	reboot	before-target-publish	4ebc2b48-60b6-429b-a5f0-8d7025576200	03d54393-87e8-4ac1-bb4a-19459be1c94e	PASS
btrfs	reboot	after-target-publish	03d54393-87e8-4ac1-bb4a-19459be1c94e	ee780760-0bd3-40ad-a3de-6537e972c357	PASS
btrfs	reboot	activation	ee780760-0bd3-40ad-a3de-6537e972c357	f1db0ea0-f423-4103-b42f-921f9f5d83a6	PASS
btrfs	reboot	after-activation	f1db0ea0-f423-4103-b42f-921f9f5d83a6	21ed6e80-fdc2-4768-a0b8-ca01fdec6c02	PASS
btrfs	reboot	confirmed-write	21ed6e80-fdc2-4768-a0b8-ca01fdec6c02	ef615063-4a0a-4f6e-b519-dcd025679ee9	PASS
btrfs	reboot	sqlite-rollback	ef615063-4a0a-4f6e-b519-dcd025679ee9	f5ad6bb4-6a37-4385-a75a-ff55fb747e3a	PASS
btrfs	reboot	sqlite-wal	f5ad6bb4-6a37-4385-a75a-ff55fb747e3a	8c889a81-839c-4aeb-b4fa-6b47fc738745	PASS
btrfs	reboot	recovery	8c889a81-839c-4aeb-b4fa-6b47fc738745	495af7f1-7209-4643-9a28-868c1b13d521	PASS
btrfs	hard-power-off	before-source-fence	495af7f1-7209-4643-9a28-868c1b13d521	a876ca84-8d08-41c6-9147-84a609be9eaa	PASS
btrfs	hard-power-off	after-source-fence	a876ca84-8d08-41c6-9147-84a609be9eaa	deb7f33e-4dc1-43bd-bc9e-7788ff6f9eb5	PASS
btrfs	hard-power-off	staging	deb7f33e-4dc1-43bd-bc9e-7788ff6f9eb5	fdaf7456-b67d-4856-b071-ede3be299170	PASS
btrfs	hard-power-off	before-target-publish	fdaf7456-b67d-4856-b071-ede3be299170	de76ae75-153c-40c9-aaac-b9ebb5441689	PASS
btrfs	hard-power-off	after-target-publish	de76ae75-153c-40c9-aaac-b9ebb5441689	2047c56d-7b40-4e0f-a146-e1b213f4d06e	PASS
btrfs	hard-power-off	activation	2047c56d-7b40-4e0f-a146-e1b213f4d06e	0b841516-9200-4ad1-b9a3-5199a1d3b404	PASS
btrfs	hard-power-off	after-activation	0b841516-9200-4ad1-b9a3-5199a1d3b404	d7d8e582-5cb6-4a13-8a5f-f75427cab755	PASS
btrfs	hard-power-off	confirmed-write	d7d8e582-5cb6-4a13-8a5f-f75427cab755	58a3fa3a-a3ff-4df6-8f05-586de6e55bc4	PASS
btrfs	hard-power-off	sqlite-rollback	58a3fa3a-a3ff-4df6-8f05-586de6e55bc4	3211b422-92a6-4d1f-88c3-618c801529b8	PASS
btrfs	hard-power-off	sqlite-wal	3211b422-92a6-4d1f-88c3-618c801529b8	e84ec68d-f778-4934-9f2d-fde24c14134c	PASS
btrfs	hard-power-off	recovery	e84ec68d-f778-4934-9f2d-fde24c14134c	e2a76bd4-3edb-42e6-81b9-75af771a113d	PASS
xfs	reboot	before-source-fence	fcf337aa-7b57-43c7-8c4f-727d335db7ce	c04087cb-d50c-4b68-9648-c17181057aa8	PASS
xfs	reboot	after-source-fence	c04087cb-d50c-4b68-9648-c17181057aa8	7b64b85f-2519-473c-a0a1-b05fca307da4	PASS
xfs	reboot	staging	7b64b85f-2519-473c-a0a1-b05fca307da4	0b79289a-4034-4ace-901c-912a857b2ca8	PASS
xfs	reboot	before-target-publish	0b79289a-4034-4ace-901c-912a857b2ca8	bfc181eb-25f5-47c1-a2c0-2bd80a64c72e	PASS
xfs	reboot	after-target-publish	bfc181eb-25f5-47c1-a2c0-2bd80a64c72e	aeab9958-f17e-4373-ab4c-c3a848f70cfa	PASS
xfs	reboot	activation	aeab9958-f17e-4373-ab4c-c3a848f70cfa	1e89ab87-28c0-46ac-b05e-ba3f3061f72c	PASS
xfs	reboot	after-activation	1e89ab87-28c0-46ac-b05e-ba3f3061f72c	394d6a2b-e6ec-4278-aa76-c832214077a8	PASS
xfs	reboot	confirmed-write	394d6a2b-e6ec-4278-aa76-c832214077a8	f3dfe81f-794d-46b6-8756-db4b004ef8bd	PASS
xfs	reboot	sqlite-rollback	f3dfe81f-794d-46b6-8756-db4b004ef8bd	a984082a-cdea-48cd-969f-3ea8086c78b9	PASS
xfs	reboot	sqlite-wal	a984082a-cdea-48cd-969f-3ea8086c78b9	157fb5b2-9445-497d-8891-484e7697bb24	PASS
xfs	reboot	recovery	157fb5b2-9445-497d-8891-484e7697bb24	00eace36-5552-4f9f-919b-f165decba7c4	PASS
xfs	hard-power-off	before-source-fence	00eace36-5552-4f9f-919b-f165decba7c4	3f329d0b-ac5d-4108-ae00-24c1ef477685	PASS
xfs	hard-power-off	after-source-fence	3f329d0b-ac5d-4108-ae00-24c1ef477685	509e4abc-892a-43ae-96ee-c66ea6e1c8ad	PASS
xfs	hard-power-off	staging	509e4abc-892a-43ae-96ee-c66ea6e1c8ad	b8e802fc-d2f8-4f32-86bd-2d643c318ad2	PASS
xfs	hard-power-off	before-target-publish	b8e802fc-d2f8-4f32-86bd-2d643c318ad2	930193db-4c61-40fa-8013-df6b685c9ec2	PASS
xfs	hard-power-off	after-target-publish	930193db-4c61-40fa-8013-df6b685c9ec2	535c4713-5ba8-4f17-90ae-c70143a2a671	PASS
xfs	hard-power-off	activation	535c4713-5ba8-4f17-90ae-c70143a2a671	961fb8d3-5d8f-400b-b572-d54042f23b7e	PASS
xfs	hard-power-off	after-activation	961fb8d3-5d8f-400b-b572-d54042f23b7e	934e8d7b-cb96-4d26-87a4-f78af0df7595	PASS
xfs	hard-power-off	confirmed-write	934e8d7b-cb96-4d26-87a4-f78af0df7595	c1a1c6eb-f426-40e4-9507-5e0812522a6d	PASS
xfs	hard-power-off	sqlite-rollback	c1a1c6eb-f426-40e4-9507-5e0812522a6d	fdc062ee-80ee-40fd-8134-0cda14cd9bd8	PASS
xfs	hard-power-off	sqlite-wal	fdc062ee-80ee-40fd-8134-0cda14cd9bd8	5889a728-f306-432b-8ccc-e03d1e6ab0dc	PASS
xfs	hard-power-off	recovery	5889a728-f306-432b-8ccc-e03d1e6ab0dc	a08beb04-6f5a-41f2-89ef-a18fb3416a9e	PASS
```
