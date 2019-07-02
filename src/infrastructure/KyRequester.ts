import Ky from 'ky-universal';
import FormData from 'form-data';
import Stream from 'stream';
import { decamelizeKeys } from 'humps';
import { stringify } from 'query-string';
import { skipAllCaps } from './Utils';
import { Requester } from '.';

const methods = ['get', 'post', 'put', 'delete', 'stream'];
const KyRequester = {} as Requester;

function responseHeadersAsObject(response) {
  const headers = {};
  const keyVals = [...response.headers.entries()];

  keyVals.forEach(([key, val]) => {
    headers[key] = val;
  });

  return headers;
}

function defaultRequest(service: any, { body, query, sudo, method }) {
  const headers = new Headers(service.headers);
  const readableStream = new Stream.Readable();
  let bod = body;

  if (sudo) headers.append('sudo', `${sudo}`);

  if (typeof body === 'object' && !(body instanceof FormData)) {
    bod = JSON.stringify(decamelizeKeys(body, skipAllCaps));
    headers.append('content-type', 'application/json');
  }

  return {
    timeout: service.requestTimeout,
    headers,
    prefixUrl: service.url,
    body: bod,
    method: method === 'stream' ? 'get' : method,
    searchParams: stringify(decamelizeKeys(query || {}) as any, { arrayFormat: 'bracket' }),
    onDownloadProgress:
      method !== 'stream'
        ? undefined
        : ({}, chunk) => {
            readableStream.push(chunk);
          },

    readableStream,
  };
}

async function processBody(response) {
  const contentType = response.headers.get('content-type') || '';
  const content = await response.text();

  if (contentType.includes('json')) {
    try {
      return JSON.parse(content || '{}');
    } catch {
      return {};
    }
  }

  return content;
}

methods.forEach(m => {
  KyRequester[m] = async function(service, endpoint, options) {
    const { readableStream, ...requestOptions } = defaultRequest(service, {
      ...options,
      method: m,
    });
    let response;

    try {
      response = Ky(endpoint, requestOptions);
    } catch (e) {
      if (e.response) {
        const output = await e.response.json();

        e.description = output.error || output.message;
      }

      throw e;
    }

    if (m !== 'stream') return readableStream;
    else response = await response;

    const { status } = response;
    const headers = responseHeadersAsObject(response);
    const body = await processBody(response);

    return { body, headers, status };
  };
});

export { KyRequester };
