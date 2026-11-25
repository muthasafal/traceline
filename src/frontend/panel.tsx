import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  TextArea,
  Tooltip,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
interface Node {
  id: string;
  key: string;
  title: string;
  kind: string;
  kindLabel: string;
  position: 'upstream' | 'self' | 'downstream';
  status: { text: string; tone: Tone; suspect?: { reason: string } };
}
interface View {
  tracked: boolean;
  issueKey: string;
  kinds?: { kind: string; label: string }[];
  standard?: string;
  levelName?: string;
  level?: string;
  kind?: string;
  kindLabel?: string;
  version?: number;
  result?: string;
  sample?: boolean;
  chain?: { summary: string; columns: { kind: string; label: string; nodes: Node[] }[] };
  gaps?: { clause: string; message: string; blocking: boolean }[];
  suspects?: { edgeId: string; rel: string; fromKey: string; toKey: string; since: string; reason: string; canReverifyByTest: boolean }[];
  evidence?: { result: string; at: string; against_version: number | null }[];
}

const APPEARANCE: Record<Tone, 'success' | 'moved' | 'removed' | 'default'> = {
  ok: 'success',
  warn: 'moved',
  bad: 'removed',
  neutral: 'default',
};

const column = xcss({ minWidth: '150px', maxWidth: '220px' });
const card = (self: boolean, suspect: boolean) =>
  xcss({
    padding: 'space.100',
    borderRadius: 'radius.medium',
    borderWidth: self ? 'border.width.selected' : 'border.width',
    borderStyle: 'solid',
    borderColor: suspect ? 'color.border.danger' : self ? 'color.border.selected' : 'color.border',
    backgroundColor: self ? 'color.background.selected' : 'elevation.surface',
  });

function Chain({ view }: { view: View }) {
  const cols = view.chain!.columns;
  return (
    <Box xcss={xcss({ overflowX: 'auto', paddingBlock: 'space.100' })}>
      <Inline space="space.150" alignBlock="start" shouldWrap={false}>
        {cols.map((c, i) => (
          <Inline key={c.kind} space="space.150" alignBlock="center">
            <Box xcss={column}>
              <Stack space="space.075">
                <Text size="small" color="color.text.subtle">
                  {c.label}
                </Text>
                {c.nodes.map((n) => (
                  <Box key={n.id} xcss={card(n.position === 'self', n.status.tone === 'bad' && !!n.status.suspect)}>
                    <Stack space="space.050">
                      <Tooltip content={n.title}>
                        <Text weight="bold">{n.key}</Text>
                      </Tooltip>
                      <Lozenge appearance={APPEARANCE[n.status.tone]} isBold={!!n.status.suspect}>
                        {n.status.text}
                      </Lozenge>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
            {i < cols.length - 1 ? <Text color="color.text.subtlest">→</Text> : null}
          </Inline>
        ))}
      </Inline>
    </Box>
  );
}

function App() {
  const [view, setView] = useState<View | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [clearing, setClearing] = useState<string | undefined>();
  const [justification, setJustification] = useState('');
  const [explain, setExplain] = useState<string | undefined>();

  const run = async (name: string, payload: Record<string, unknown> = {}) => {
    setBusy(name);
    setError(undefined);
    try {
      setView((await invoke(name, payload)) as View);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => {
    run('getTrace');
  }, []);

  if (!view) return error ? <SectionMessage appearance="error">{error}</SectionMessage> : <Spinner label="Loading trace" />;

  if (!view.tracked) {
    return (
      <Stack space="space.150">
        <Text>Traceline does not track {view.issueKey} yet. Tell it what this issue is, and it will build the trace chain from its links.</Text>
        <ButtonGroup label="Track as">
          {(view.kinds ?? []).map((k) => (
            <Button key={k.kind} isDisabled={!!busy} onClick={() => run('trackAs', { kind: k.kind })}>
              {k.label}
            </Button>
          ))}
        </ButtonGroup>
        {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      </Stack>
    );
  }

  const blocking = (view.gaps ?? []).filter((g) => g.blocking);
  const warnings = (view.gaps ?? []).filter((g) => !g.blocking);

  return (
    <Stack space="space.200">
      {view.sample ? (
        <SectionMessage appearance="information">
          <Text>Sample data: a fictional infusion pump created by Traceline&apos;s sample loader.</Text>
        </SectionMessage>
      ) : null}
      <Stack space="space.050">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Lozenge>{view.kindLabel}</Lozenge>
          <Text size="small">
            {view.levelName} {view.level} · {view.standard} · version {view.version}
          </Text>
        </Inline>
        <Text>{view.chain!.summary}</Text>
      </Stack>

      <Chain view={view} />

      {(view.suspects ?? []).map((s) => (
        <SectionMessage key={s.edgeId} appearance="warning" title={`Suspect link: ${s.fromKey} ${s.rel} ${s.toKey}`}>
          <Stack space="space.100">
            {explain === s.edgeId ? <Text>{s.reason}</Text> : null}
            {clearing === s.edgeId ? (
              <Stack space="space.100">
                <TextArea
                  name="justification"
                  placeholder="Why does this change not need re-verification? This is recorded for the audit trail."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                />
                <ButtonGroup label="Clear suspect">
                  <Button
                    appearance="primary"
                    isDisabled={justification.trim().length < 10 || !!busy}
                    onClick={async () => {
                      await run('clearSuspect', { edgeId: s.edgeId, justification });
                      setClearing(undefined);
                      setJustification('');
                    }}
                  >
                    Clear with justification
                  </Button>
                  <Button appearance="subtle" onClick={() => setClearing(undefined)}>
                    Cancel
                  </Button>
                </ButtonGroup>
              </Stack>
            ) : (
              <ButtonGroup label="Suspect actions">
                <Button appearance="subtle" onClick={() => setExplain(explain === s.edgeId ? undefined : s.edgeId)}>
                  {explain === s.edgeId ? 'Hide explanation' : 'Why is this suspect?'}
                </Button>
                {!s.canReverifyByTest ? (
                  <Button isDisabled={!!busy} onClick={() => run('reverifyLink', { edgeId: s.edgeId })}>
                    Mark link reviewed
                  </Button>
                ) : null}
                <Button appearance="subtle" onClick={() => setClearing(s.edgeId)}>
                  Clear with justification…
                </Button>
              </ButtonGroup>
            )}
          </Stack>
        </SectionMessage>
      ))}

      {view.kind === 'VER' ? (
        <Stack space="space.100">
          <Heading size="xsmall">Test result</Heading>
          <Text>
            {view.result === 'pass' || view.result === 'fail'
              ? `Latest result: ${view.result === 'pass' ? 'passed' : 'failed'}${view.evidence?.[0] ? ` on ${view.evidence[0].at.slice(0, 10)}` : ''}.`
              : 'No result recorded yet.'}{' '}
            Recording a result verifies the current version of everything this test is linked to.
          </Text>
          <ButtonGroup label="Record result">
            <Button appearance="primary" isDisabled={!!busy} onClick={() => run('recordResult', { result: 'pass' })}>
              Record pass
            </Button>
            <Button appearance="danger" isDisabled={!!busy} onClick={() => run('recordResult', { result: 'fail' })}>
              Record fail
            </Button>
          </ButtonGroup>
        </Stack>
      ) : null}

      {blocking.length || warnings.length ? (
        <Stack space="space.100">
          <Heading size="xsmall">
            {blocking.length} blocking gap{blocking.length === 1 ? '' : 's'}
            {warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}
          </Heading>
          {[...blocking, ...warnings].map((g, i) => (
            <Inline key={i} space="space.100" alignBlock="start">
              <Lozenge appearance={g.blocking ? 'removed' : 'moved'}>§{g.clause}</Lozenge>
              <Text>{g.message}</Text>
            </Inline>
          ))}
        </Stack>
      ) : (
        <Text color="color.text.success">No gaps for this item under {view.standard}.</Text>
      )}

      <Inline space="space.100" alignBlock="center">
        <Button appearance="subtle" isDisabled={!!busy} onClick={() => run('refresh')}>
          Refresh from Jira
        </Button>
        {busy ? <Spinner size="small" label="Working" /> : null}
      </Inline>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
