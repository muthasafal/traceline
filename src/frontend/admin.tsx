import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Lozenge,
  ProgressBar,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Toggle,
  Label,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

interface Status {
  settings: { pack: string; defaultLevel: string; validatorEnabled: boolean; validatorLevels: string[] };
  packs: { id: string; name: string; levels: string[]; levelName: string }[];
  sample: { status: string; step?: string; progress?: number; message?: string; projectKey?: string; spaceKey?: string; finishedAt?: string };
  sampleProjectKey: string;
  counts: Record<string, number>;
  gaps: number;
  blocking: number;
  openSuspects: number;
  sampleGate?: { summary: string; green: boolean };
  lastRecompute?: { at: string; issues: number; pages: number; newSuspects: number };
}

const panel = xcss({ padding: 'space.200', borderRadius: 'radius.medium', borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border' });

function App() {
  const [st, setSt] = useState<Status | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const run = async (name: string, payload: Record<string, unknown> = {}) => {
    setError(undefined);
    try {
      setSt((await invoke(name, payload)) as Status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    run('getStatus');
  }, []);

  // Poll while a sample job runs.
  useEffect(() => {
    const busy = st && (st.sample.status === 'running' || st.sample.status === 'removing');
    if (busy) timer.current = setTimeout(() => run('getStatus'), 3000);
    return () => clearTimeout(timer.current);
  }, [st]);

  if (!st) return error ? <SectionMessage appearance="error">{error}</SectionMessage> : <Spinner label="Loading" />;

  const pack = st.packs.find((p) => p.id === st.settings.pack)!;
  const total = Object.values(st.counts).reduce((a, b) => a + b, 0);
  const busy = st.sample.status === 'running' || st.sample.status === 'removing';
  const hasSample = st.sample.status === 'done' || (st.sample.status === 'failed' && !!st.sample.projectKey);

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading size="large">Traceline</Heading>
        <Text>
          Living traceability for safety-critical software. Traceline reads your Jira issues and Confluence pages, builds the
          trace graph, flags gaps and suspect links, and blocks risky transitions to Done.
        </Text>
      </Stack>

      <Box xcss={panel}>
        <Stack space="space.150">
          <Heading size="medium">Sample project</Heading>
          <Text>
            Creates a clearly labelled sample: a fictional infusion pump controller (Class C) with 15 system requirements, 30
            software requirements, 8 hazards, 10 risk controls, 35 stories and 40 tests in a new Jira project ({st.sampleProjectKey})
            and Confluence space. It has a few deliberate gaps and one suspect link so you can see Traceline find them. It takes
            about 5 minutes.
          </Text>
          {busy ? (
            <Stack space="space.100">
              <Text>{st.sample.step ?? 'Working'}…</Text>
              <ProgressBar value={(st.sample.progress ?? 1) / 100} ariaLabel="Sample progress" />
            </Stack>
          ) : null}
          {st.sample.status === 'failed' ? (
            <SectionMessage appearance="error" title="The sample loader stopped">
              <Text>{st.sample.message}</Text>
            </SectionMessage>
          ) : null}
          {st.sample.status === 'done' ? (
            <SectionMessage appearance="success" title="Sample project ready">
              <Text>
                Open project {st.sample.projectKey} and any issue to see the Trace panel. {st.sampleGate?.summary}
              </Text>
            </SectionMessage>
          ) : null}
          <ButtonGroup label="Sample data">
            <Button appearance="primary" isDisabled={busy || st.sample.status === 'done'} onClick={() => run('loadSample')}>
              Load sample project
            </Button>
            {hasSample && !confirmRemove ? (
              <Button appearance="subtle" isDisabled={busy} onClick={() => setConfirmRemove(true)}>
                Remove sample data
              </Button>
            ) : null}
          </ButtonGroup>
          {confirmRemove ? (
            <SectionMessage appearance="warning" title="Remove the sample data?">
              <Stack space="space.100">
                <Text>
                  This deletes every issue labelled traceline-sample, moves the {st.sample.projectKey} project to the trash, and
                  deletes the {st.sample.spaceKey} space. Nothing else is touched.
                </Text>
                <ButtonGroup label="Confirm">
                  <Button appearance="danger" onClick={() => { setConfirmRemove(false); run('removeSample'); }}>
                    Remove sample data
                  </Button>
                  <Button appearance="subtle" onClick={() => setConfirmRemove(false)}>
                    Keep it
                  </Button>
                </ButtonGroup>
              </Stack>
            </SectionMessage>
          ) : null}
        </Stack>
      </Box>

      <Box xcss={panel}>
        <Stack space="space.150">
          <Heading size="medium">Trace graph</Heading>
          <Text>
            {total
              ? `Traceline tracks ${total} artifacts with ${st.gaps} gap${st.gaps === 1 ? '' : 's'} (${st.blocking} blocking) and ${st.openSuspects} open suspect link${st.openSuspects === 1 ? '' : 's'}.`
              : 'Nothing is tracked yet. Load the sample project, or label issues tl-requirement, tl-hazard, tl-risk-control or tl-test and link them.'}
          </Text>
          {st.lastRecompute ? (
            <Text size="small" color="color.text.subtle">
              Last full recompute {st.lastRecompute.at.slice(0, 16).replace('T', ' ')} UTC: {st.lastRecompute.issues} issues,{' '}
              {st.lastRecompute.pages} pages.
            </Text>
          ) : null}
          <Inline>
            <Button appearance="subtle" onClick={() => run('recompute')}>
              Recompute now
            </Button>
          </Inline>
        </Stack>
      </Box>

      <Box xcss={panel}>
        <Stack space="space.150">
          <Heading size="medium">Settings</Heading>
          <Stack space="space.050">
            <Label labelFor="pack">Standard pack</Label>
            <Select
              id="pack"
              value={{ label: pack.name, value: pack.id }}
              options={st.packs.map((p) => ({ label: p.name, value: p.id }))}
              onChange={(o: { value: string }) => run('saveSettings', { pack: o.value })}
            />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="level">Default {pack.levelName.toLowerCase()}</Label>
            <Select
              id="level"
              value={{ label: st.settings.defaultLevel, value: st.settings.defaultLevel }}
              options={pack.levels.map((l) => ({ label: l, value: l }))}
              onChange={(o: { value: string }) => run('saveSettings', { defaultLevel: o.value })}
            />
          </Stack>
          <Inline space="space.100" alignBlock="center">
            <Toggle
              id="validator"
              isChecked={st.settings.validatorEnabled}
              onChange={() => run('saveSettings', { validatorEnabled: !st.settings.validatorEnabled })}
            />
            <Label labelFor="validator">
              Workflow validator blocks Done at {st.settings.validatorLevels.join(', ') || 'no levels'}
            </Label>
          </Inline>
          <Inline space="space.100" shouldWrap>
            {pack.levels.map((l) => {
              const on = st.settings.validatorLevels.includes(l);
              return (
                <Button
                  key={l}
                  appearance={on ? 'primary' : 'default'}
                  onClick={() =>
                    run('saveSettings', {
                      validatorLevels: on ? st.settings.validatorLevels.filter((x) => x !== l) : [...st.settings.validatorLevels, l],
                    })
                  }
                >
                  {`${pack.levelName} ${l}`}
                </Button>
              );
            })}
          </Inline>
          <Text size="small" color="color.text.subtle">
            To use the validator, add the Traceline "Requires passing verification" validator to the Done transition of a
            company-managed workflow.
          </Text>
          <Lozenge>Data stays on Atlassian: Traceline runs on Forge with no external calls.</Lozenge>
        </Stack>
      </Box>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
