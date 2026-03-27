import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadPlaybook(): any[] {
  const content = readFileSync(resolve(ROOT, 'ansible', 'playbooks', 'site.yml'), 'utf8');
  const docs = yaml.load(content) as any[];
  // site.yml is a YAML list of plays (standard Ansible playbook format)
  return Array.isArray(docs) ? docs : [docs];
}

const playbook = loadPlaybook();

/**
 * Collect all package names from yum/dnf/package tasks across all plays and tasks.
 */
function collectInstalledPackages(plays: any[]): string[] {
  const packages: string[] = [];
  for (const play of plays) {
    const tasks: any[] = play.tasks || [];
    for (const task of tasks) {
      // Check ansible.builtin.yum, ansible.builtin.dnf, ansible.builtin.package, yum, dnf, package
      const moduleKeys = [
        'ansible.builtin.yum', 'ansible.builtin.dnf', 'ansible.builtin.package',
        'yum', 'dnf', 'package',
      ];
      for (const key of moduleKeys) {
        const mod = task[key];
        if (mod && mod.name) {
          if (Array.isArray(mod.name)) {
            packages.push(...mod.name);
          } else {
            packages.push(mod.name);
          }
        }
      }
    }
  }
  return packages;
}

/**
 * Collect all service tasks and their configuration.
 */
function collectServiceTasks(plays: any[]): Array<{ name: string; state?: string; enabled?: boolean }> {
  const services: Array<{ name: string; state?: string; enabled?: boolean }> = [];
  for (const play of plays) {
    const tasks: any[] = play.tasks || [];
    for (const task of tasks) {
      const moduleKeys = ['ansible.builtin.service', 'ansible.builtin.systemd', 'service', 'systemd'];
      for (const key of moduleKeys) {
        const mod = task[key];
        if (mod && mod.name) {
          services.push({
            name: mod.name,
            state: mod.state,
            enabled: mod.enabled,
          });
        }
      }
    }
  }
  return services;
}

const allPackages = collectInstalledPackages(playbook);
const allServices = collectServiceTasks(playbook);

// ---------------------------------------------------------------------------
// Validates: Requirement 10.1 — Apache httpd installed
// ---------------------------------------------------------------------------
describe('Ansible playbook package installation', () => {
  it('installs httpd (Apache HTTP Server)', () => {
    expect(allPackages).toContain('httpd');
  });

  // Validates: Requirement 10.2 — PHP and required modules
  it('installs php and required php modules', () => {
    const requiredPhpPackages = ['php', 'php-mysqlnd', 'php-fpm', 'php-json', 'php-xml'];
    for (const pkg of requiredPhpPackages) {
      expect(allPackages, `missing package: ${pkg}`).toContain(pkg);
    }
  });

  // Validates: Requirement 10.4 — Python 3 and pip
  it('installs python3 and pip', () => {
    const hasPython3 = allPackages.some(p => p === 'python3' || p === 'python3-pip');
    expect(hasPython3).toBe(true);

    const hasPip = allPackages.some(p => p === 'python3-pip' || p === 'pip' || p === 'pip3');
    expect(hasPip).toBe(true);
  });

  // Validates: Requirement 10.5 — MariaDB client
  it('installs mariadb client package', () => {
    const hasMariadb = allPackages.some(p => p.startsWith('mariadb'));
    expect(hasMariadb).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validates: Requirement 10.6 — httpd service enabled and started
// Validates: Requirement 10.7 — php-fpm service enabled and started
// ---------------------------------------------------------------------------
describe('Ansible playbook service configuration', () => {
  it('enables and starts httpd service', () => {
    const httpdService = allServices.find(s => s.name === 'httpd');
    expect(httpdService).toBeDefined();
    expect(httpdService!.state).toBe('started');
    expect(httpdService!.enabled).toBe(true);
  });

  it('enables and starts php-fpm service', () => {
    const phpFpmService = allServices.find(s => s.name === 'php-fpm');
    expect(phpFpmService).toBeDefined();
    expect(phpFpmService!.state).toBe('started');
    expect(phpFpmService!.enabled).toBe(true);
  });
});
