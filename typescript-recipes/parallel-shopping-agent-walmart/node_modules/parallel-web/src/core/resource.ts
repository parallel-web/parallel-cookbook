// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { Parallel } from '../client';

export abstract class APIResource {
  protected _client: Parallel;

  constructor(client: Parallel) {
    this._client = client;
  }
}
