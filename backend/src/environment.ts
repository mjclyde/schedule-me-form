type EnvironmentType = 'PROD' | 'TEST' | 'DEV';

export class Environment {
  static get ENV(): EnvironmentType { return Environment.clean(process.env.ENV, 'DEV') as EnvironmentType; }

  static get DB_NAME(): string { return Environment.clean(process.env.DB_NAME, 'cloud'); }
  static get DB_URI(): string { return Environment.clean(process.env.DB_URI); }

  static get PORT(): number { return +(this.clean(process.env.PORT || '3000')); }

  private static clean(variable?: string, defaultValue = '') {
    return (variable || defaultValue).replace(/"/gi, '');
  }
}
