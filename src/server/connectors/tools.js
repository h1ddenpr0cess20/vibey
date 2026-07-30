import { agentLabel } from './agents.js';

/** The three function tools the proxy answers itself, once a connector is on. */
export const CONNECTOR_TOOLS = Object.freeze(['dispatch_task', 'check_task', 'cancel_task']);

export function isConnectorTool(name) {
  return CONNECTOR_TOOLS.includes(name);
}

/** The HUD caption for one, in the same register as the rest. */
export function connectorLabel(name) {
  switch (name) {
    case 'dispatch_task': return 'handing it over';
    case 'check_task': return 'checking on it';
    case 'cancel_task': return 'calling it off';
    default: return null;
  }
}

export function connectorTools(agents = []) {
  if (!agents.length) return [];

  const roster = agents.map((name) => `${name} (${agentLabel(name)})`).join(', ');

  return [
    {
      type: 'function',
      name: 'dispatch_task',
      description: `Hand one task to a coding agent, which does it for real in the workspace — reading, writing and running things. Available: ${roster}. It returns immediately with a task number and then keeps running, so do not wait for it, do not describe the result, and do not say it is finished. Read the task back to the person and get a yes before calling this, and get an explicit yes for anything that does not come back — deleting, force pushing, touching production.`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The whole task, written for someone who was not in the conversation: what to change, where, and what done looks like. Several sentences is fine — this is the only thing the agent sees.',
          },
          agent: {
            type: 'string',
            enum: [...agents],
            description: agents.length > 1
              ? 'Which agent takes it. Ask only if they have a preference; otherwise pick one and say which.'
              : 'Which agent takes it.',
          },
        },
        required: ['task'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'check_task',
      description: 'Where a dispatched task stands: still running, finished, or broken, with what the agent said. Call it when they ask, and before you tell them anything about work you dispatched — you know nothing about a task you have not checked.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The task number. Leave it out for everything dispatched this session.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'cancel_task',
      description: 'Stop a task that is still running. Whatever it already wrote to disk stays written, so say that once it is stopped.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The task number.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  ];
}
