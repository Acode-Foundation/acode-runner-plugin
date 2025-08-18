const confirm = acode.require('confirm');
const loader = acode.require('loader');

export default class LanguageRunners {
	#runners = new Map();
	
	init() {
		this.#initializeDefaultRunners();
	}

	/**
	 * Initialize default language runners
	 */
	#initializeDefaultRunners() {
		// Python
		this.#runners.set('python', {
			extensions: ['py', 'pyw'],
			commands: [
				{ cmd: 'python3 "{file}"', packages: ['python3', 'py3-pip'] },
				{ cmd: 'python "{file}"', packages: ['python3'] }
			],
			description: 'Python interpreter'
		});

		// C
		this.#runners.set('c', {
			extensions: ['c'],
			commands: [
				{
					cmd: 'gcc "{file}" -o "{name}" && ./{name}',
					packages: ['gcc', 'musl-dev']
				},
				{
					cmd: 'clang "{file}" -o "{name}" && ./{name}',
					packages: ['clang']
				}
			],
			description: 'C compiler'
		});

		// C++
		this.#runners.set('cpp', {
			extensions: ['cpp', 'cxx', 'cc', 'c++'],
			commands: [
				{
					cmd: 'clang++ "{file}" -o "{name}" && ./{name}',
					packages: ['clang']
				}
			],
			description: 'C++ compiler'
		});

		// Java
		this.#runners.set('java', {
			extensions: ['java'],
			commands: [
				{ cmd: 'java "{file}"', packages: ['openjdk17-jdk'] },
				{ cmd: 'javac "{file}" && java "{name}"', packages: ['openjdk11-jdk'] }
			],
			description: 'Java compiler and runtime'
		});

		// Go
		this.#runners.set('go', {
			extensions: ['go'],
			commands: [
				{ cmd: 'go run "{file}"', packages: ['go'] }
			],
			description: 'Go compiler'
		});

		// PHP
		this.#runners.set('php', {
			extensions: ['php'],
			commands: [
				{ cmd: 'php82 "{file}"', packages: ['php82', 'php82-cli'] }
			],
			description: 'PHP interpreter'
		});

		// Ruby
		this.#runners.set('ruby', {
			extensions: ['rb'],
			commands: [
				{ cmd: 'ruby "{file}"', packages: ['ruby', 'ruby-dev'] }
			],
			description: 'Ruby interpreter'
		});

		// Rust
		this.#runners.set('rust', {
			extensions: ['rs'],
			commands: [
				{ cmd: 'rustc "{file}" -o "{name}" && ./{name}', packages: ['rust'] },
				{ cmd: 'cargo run', packages: ['cargo'], requiresCargo: true }
			],
			description: 'Rust compiler'
		});

		// Lua
		this.#runners.set("lua", {
			extensions: ["lua"],
			commands: [{ cmd: 'lua5.4 "{file}"', packages: ["lua5.4"] }],
			description: "Lua interpreter"
		});

		// Shell scripts
		this.#runners.set('shell', {
			extensions: ['sh', 'bash'],
			commands: [
				{ cmd: 'bash "{file}"', packages: ['bash'] },
				{ cmd: 'sh "{file}"', packages: [] }
			],
			description: 'Shell script interpreter'
		});
	}

	/**
	 * Get runner for file extension
	 */
	getRunnerForExtension(extension) {
		for (const [id, runner] of this.#runners) {	
			if (runner.extensions.includes(extension.toLowerCase())) {
				return { id, ...runner };
			}
		}
		return null;
	}

	/**
	 * Check if file can be run
	 */
	canRun(filename) {
		if (!filename) return false;
		
		// Quick extension check
		const lastDot = filename.lastIndexOf('.');
		if (lastDot === -1) return false;
		
		const extension = filename.substring(lastDot + 1).toLowerCase();
		
		// Fast lookup through all languages
		for (const runner of this.#runners.values()) {
			if (runner.extensions.includes(extension)) {
				return true;
			}
		}
		
		return false;
	}

	/**
	 * Run file using appropriate language runner
	 */
	async runFile(file) {
		if (!file || file.type !== 'editor') {
			window.toast('Cannot run this file type');
			return;
		}

		const extension = acode.require('Url').extname(file.filename).substring(1);
		const runner = this.getRunnerForExtension(extension);

		if (!runner) {
			window.toast(`No runner configured for .${extension} files`);
			return;
		}

		// Try to run with available command
		await this.#executeWithRunner(runner, file);
	}

	/**
	 * Execute file with specific runner
	 */
	async #executeWithRunner(runner, file) {
		const filename = file.filename;
		const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
		
		for (const commandConfig of runner.commands) {
			try {
				if (commandConfig.requiresCargo && file.uri && !await this.#checkCargoProject(file.uri)) {
					continue;
				}

				const commandExists = await this.#checkCommandExists(commandConfig);
				if (!commandExists) {
					const confirmed = await this.#offerPackageInstallation(runner, commandConfig);
					if (!confirmed) {
						continue; // Skip this command if user declined installation
					}
				}

				const success = await this.#tryCommand(commandConfig, file, nameWithoutExt);
				if (success) {
					return;
				}
			} catch (error) {
				console.warn(`Command failed: ${commandConfig.cmd}`, error);
			}
		}

		window.toast(`No working ${runner.description} found. Please install manually or check terminal for errors.`);
	}

	/**
	 * Try to execute a specific command
	 */
	async #tryCommand(commandConfig, file, nameWithoutExt) {
		try {
			const filename = file.filename;
			const fileContent = file.session.getValue();
			
			const terminal = await this.#getOrCreateTerminal(filename);

			if (!terminal) {
				return false;
			}

			terminal.file.makeActive();

			await this.#executeWithWrapper(terminal, commandConfig, file, nameWithoutExt, fileContent);
			
			return true;
		} catch (error) {
			console.error('Error executing command:', error);
			return false;
		}
	}

	/**
	 * Execute command with a nice wrapper script for better UX
	 */
	async #executeWithWrapper(terminal, commandConfig, file, nameWithoutExt, fileContent) {
		const filename = file.filename;
		const extension = filename.split('.').pop() || '';
		
		// Create wrapper script content
		const wrapperScript = await this.#createWrapperScript(commandConfig, file, nameWithoutExt, fileContent);
		const wrapperPath = `/tmp/acode_runner_${Date.now()}.sh`;
		
		// Create and execute wrapper script silently but don't use exec to avoid closing terminal
		const fullCommand = `{
cat > '${wrapperPath}' << 'WRAPPER_EOF'
${wrapperScript}
WRAPPER_EOF
chmod +x '${wrapperPath}'
'${wrapperPath}'
rm -f '${wrapperPath}'
} 2>/dev/null`;
		
		await this.#sendCommand(terminal, fullCommand);
	}

	/**
	 * Create the wrapper script content
	 */
	async #createWrapperScript(commandConfig, file, nameWithoutExt, fileContent) {
		const filename = file.filename;
		const extension = filename.split('.').pop() || '';
		const tempFile = `/tmp/${filename}`;
		
		// Determine if we need to create a temp file
		const needsTempFile = !file.uri || file.isUnsaved || 
			file.uri.startsWith('content://') || file.uri.includes('::') ||
			file.uri.startsWith('ftp:') || file.uri.startsWith('sftp:');
		
		// Prepare the actual command
		let actualCommand;
		let workingDir = '/tmp';
		
		if (needsTempFile) {
			// Use temp file
			actualCommand = commandConfig.cmd
				.replace(/\{file\}/g, tempFile)
				.replace(/\{name\}/g, nameWithoutExt)
				.replace(/\{path\}/g, tempFile);
		} else {
			// Use actual file
			const actualPath = file.uri.startsWith('file://') ? file.uri.substring(7) : file.uri;
			workingDir = actualPath.includes('/data/user/0/com.foxdebug.acode/files/alpine/home') ? '$HOME' : `'${acode.require('Url').dirname(actualPath)}'`;
			
			actualCommand = commandConfig.cmd
				.replace(/\{file\}/g, filename)
				.replace(/\{name\}/g, nameWithoutExt)
				.replace(/\{path\}/g, actualPath);
		}

		// Create the wrapper script
		let script = `#!/bin/bash\n`;
		
		// Clear screen properly and redirect any stderr from clear to /dev/null
		script += `printf '\\033[2J\\033[H' 2>/dev/null\n`;
		
		// Create temp file if needed (completely silently)
		if (needsTempFile) {
			script += `cat > '${tempFile}' << 'SOURCE_EOF' 2>/dev/null\n${fileContent}\nSOURCE_EOF\n`;
		}
		
		script += `echo -e "\\033[1;1;36m[RUNNER]\\033[0m \\033[2;37mRunning\\033[0m \\033[1;93m${filename}\\033[0m\\033[2;37m...\\033[0m"\n`;
		script += `echo\n`;

		// Change to working directory and execute
		if (workingDir !== '/tmp') {
			script += `cd ${workingDir} && ${actualCommand}\n`;
		} else {
			script += `${actualCommand}\n`;
		}
		
		// Store exit code
		script += `EXIT_CODE=$?\n`;

		// Show colored result based on exit code with separation
		script += `echo\n`;
		script += `echo -e "\\033[2;90m────────────────────────────────────────\\033[0m"\n`;
		script += `if [ $EXIT_CODE -eq 0 ]; then\n`;
		script += `    echo -e "\\033[1;1;36m[RUNNER]\\033[0m \\033[1;32m✅ Program finished successfully\\033[0m"\n`;
		script += `else\n`;
		script += `    echo -e "\\033[1;1;36m[RUNNER]\\033[0m \\033[1;31m❌ Program finished with errors\\033[0m \\033[2;90m(exit code: $EXIT_CODE)\\033[0m"\n`;
		script += `fi\n`;
		script += `echo -e "\\033[2;90m────────────────────────────────────────\\033[0m"\n`;
		
		// Clean up temp file if created (silently)
		if (needsTempFile) {
			script += `rm -f '${tempFile}' 2>/dev/null\n`;
		}
		
		// Don't exit or close terminal, just finish normally
		script += `echo\n`;
		
		return script;
	}

	/**
	 * Get existing terminal or create new one
	 */
	async #getOrCreateTerminal(filename) {
		try {
			const existingTerminals = acode.require('terminal').getAll();
			
			// Look for a terminal that's not busy with installation
			for (const [id, terminal] of existingTerminals) {
				if (!terminal.name.includes('Install:')) {
					return terminal;
				}
			}
			
			// Create new terminal
			const terminal = await acode.require('terminal').createServer({
				name: `Run: ${filename}`
			});
			
			await new Promise(resolve => setTimeout(resolve, 500));
			
			return terminal;
		} catch (error) {
			console.error('Error creating terminal:', error);
			return null;
		}
	}

	/**
	 * Send command to terminal shell process
	 */
	async #sendCommand(terminal, command) {
		if (terminal.component && terminal.component.pid) {
			try {
				await Executor.write(terminal.component.pid, command + '\r');
			} catch (error) {
				acode.require('terminal').write(terminal.id, command + '\r');
			}
		}
	}

	/**
	 * Check if a command exists in the system
	 */
	async #checkCommandExists(commandConfig) {
		try {
			const mainCommand = commandConfig.cmd.split(' ')[0];
			const result = await Executor.execute(`which ${mainCommand}`, true);
			return result && result.trim() !== '';
		} catch (error) {
			return false;
		}
	}

	/**
	 * Check if current directory is a Cargo project
	 */
	async #checkCargoProject(filePath) {
		try {
			const projectDir = acode.require('Url').dirname(filePath);
			const cargoToml = acode.require('Url').join(projectDir, 'Cargo.toml');
			const fs = acode.require('fsOperation');
			return await fs(cargoToml).exists();
		} catch {
			return false;
		}
	}

	/**
	 * Offer to install packages for a specific command
	 */
	async #offerPackageInstallation(runner, commandConfig) {
		const packages = commandConfig.packages.filter(pkg => pkg);

		if (packages.length === 0) {
			window.toast(`${runner.description} not found. Please install manually.`);
			return false;
		}

		const confirmed = await confirm(
			'Install Required Packages',
			`${runner.description} is not installed. Install packages: ${packages.join(', ')}?`
		);

		if (confirmed) {
			await this.#installPackages(packages, runner.description);
			return true;
		}

		return false;
	}

	/**
	 * Install packages using Alpine's apk package manager (background process)
	 */
	async #installPackages(packages, description) {
		const installLoader = loader.create(
			'Installing Packages',
			`Installing ${description}...`
		);

		try {
			await Executor.execute('apk update', true);

			const installCmd = `apk add ${packages.join(' ')}`;
			await Executor.execute(installCmd, true);
			installLoader.hide();
			window.toast(`${description} installed successfully!`);
		} catch (error) {
			installLoader.hide();
			console.error('Error installing packages:', error);
			window.toast(`Failed to install ${description}. Error: ${error.message || error}`);
		}
	}

	/**
	 * Register a custom language runner
	 */
	registerRunner(id, config) {
		this.#runners.set(id, config);
	}

	/**
	 * Unregister a language runner
	 */
	unregisterRunner(id) {
		this.#runners.delete(id);
	}

	/**
	 * Get all registered runners
	 */
	getAllRunners() {
		return new Map(this.#runners);
	}

	/**
	 * Get runner by ID
	 */
	getRunner(id) {
		return this.#runners.get(id) || null;
	}

	/**
	 * Cleanup when plugin is destroyed
	 */
	destroy() {
		this.#runners.clear();
	}
}