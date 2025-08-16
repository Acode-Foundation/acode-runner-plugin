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

		// Node.js / JavaScript
		// this.#runners.set('nodejs', {
		// 	extensions: ['js', 'mjs'],
		// 	commands: [
		// 		{ cmd: 'node "{file}"', packages: ['nodejs', 'npm'] }
		// 	],
		// 	description: 'Node.js JavaScript runtime',
		// 	icon: 'file_type_js'
		// });

		// C
		this.#runners.set('c', {
			extensions: ['c'],
			commands: [
				{
					cmd: 'gcc "{file}" -o "{name}" && ./{name}',
					packages: ['gcc', 'musl-dev'] // Primary option: GCC
				},
				{
					cmd: 'clang "{file}" -o "{name}" && ./{name}',
					packages: ['clang', 'musl-dev'] // Fallback option: Clang
				}
			],
			description: 'C compiler'
		});

		// C++
		this.#runners.set('cpp', {
			extensions: ['cpp', 'cxx', 'cc', 'c++'],
			commands: [
				{
					cmd: 'g++ "{file}" -o "{name}" && ./{name}',
					packages: ['g++', 'musl-dev']
				},
				{
					cmd: 'clang++ "{file}" -o "{name}" && ./{name}',
					packages: ['clang', 'musl-dev']
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
				{ cmd: 'sh "{file}"', packages: [] } // sh is built-in
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
	async runFile(file, saveFirst = false) {
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

		// Try to run with the first available command
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
				// Check if command requires special setup (like Cargo for Rust)
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

				// Try to execute the command
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
			
			await this.#sendCommand(terminal, 'clear');

			await new Promise(resolve => setTimeout(resolve, 300));

			if (file.uri && !file.isUnsaved) {
				// File is saved, we can run it directly from file system
				await this.#runSavedFile(terminal, commandConfig, file, nameWithoutExt);
			} else {
				// File is unsaved or in memory, create temporary file
				await this.#runUnsavedFile(terminal, commandConfig, file, nameWithoutExt, fileContent);
			}
			
			return true;
		} catch (error) {
			console.error('Error executing command:', error);
			return false;
		}
	}

	/**
	 * Get existing terminal or create new one
	 */
	async #getOrCreateTerminal(filename) {
		const existingTerminals = acode.require('terminal').getAll();
		
		// Look for a terminal that's not busy with installation
		for (const [id, terminal] of existingTerminals) {
			if (!terminal.name.includes('Install:')) {
				// Reuse existing terminal
				return terminal;
			}
		}
		
		// No suitable terminal found, create new one
		return await acode.require('terminal').createServer({
			name: `Run: ${filename}`
		});
	}

	/**
	 * Run saved file from file system
	 */
	async #runSavedFile(terminal, commandConfig, file, nameWithoutExt) {
		const filename = file.filename;
		const workingDir = acode.require('Url').dirname(file.uri);
		
		let command = commandConfig.cmd
			.replace(/\{file\}/g, filename)
			.replace(/\{name\}/g, nameWithoutExt)
			.replace(/\{path\}/g, file.uri);

		// Handle different file location types
		if (file.uri.startsWith('content://') || file.uri.includes('::')) {
			// SAF or complex URI - copy to temp location first
			const tempFile = `/tmp/${filename}`;
			await this.#sendCommand(terminal, `echo '${file.session.getValue().replace(/'/g, "'\\''")}' > '${tempFile}'`);
			
			// Update command to use temp file
			command = commandConfig.cmd
				.replace(/\{file\}/g, tempFile)
				.replace(/\{name\}/g, nameWithoutExt)
				.replace(/\{path\}/g, tempFile);
			
			// Execute from /tmp
			await this.#sendCommand(terminal, `${command}`);
		} else if (file.uri.startsWith('ftp:') || file.uri.startsWith('sftp:')) {
			// Remote file - use content from editor
			await this.#runUnsavedFile(terminal, commandConfig, file, nameWithoutExt, file.session.getValue());
		} else {
			// Local file - try to change to directory and run
			try {
				// Extract actual file path for local files
				let actualPath = workingDir;
				if (actualPath.startsWith('file://')) {
					actualPath = actualPath.substring(7);
				}
				
				// Use $HOME for Alpine home directory
				if (actualPath.includes('/data/user/0/com.foxdebug.acode/files/alpine/home')) {
					actualPath = '$HOME';
				}
				
				// Don't quote $HOME as it's a variable that needs expansion
				const cdCommand = actualPath === '$HOME' ? 'cd $HOME' : `cd '${actualPath}'`;
				await this.#sendCommand(terminal, `${cdCommand} && ${command}`);
			} catch (error) {
				// Fallback to temp file method
				await this.#runUnsavedFile(terminal, commandConfig, file, nameWithoutExt, file.session.getValue());
			}
		}
	}

	/**
	 * Run unsaved file content via temporary file
	 */
	async #runUnsavedFile(terminal, commandConfig, file, nameWithoutExt, content) {
		const filename = file.filename;
		const tempFile = `/tmp/${filename}`;
		
		// Create temporary file
		await this.#sendCommand(terminal, `cat > '${tempFile}' << 'ACODE_EOF'\n${content}\nACODE_EOF`);
		// Replace placeholders in command for temp file
		const command = commandConfig.cmd
			.replace(/\{file\}/g, tempFile)
			.replace(/\{name\}/g, nameWithoutExt)
			.replace(/\{path\}/g, tempFile);

		// Execute from /tmp directory
		await this.#sendCommand(terminal, `${command}`);
	}


	/**
	 * Send command to terminal shell process
	 */
	async #sendCommand(terminal, command) {
		if (terminal.component && terminal.component.pid) {
			// If we have a process ID, send to the actual shell process
			try {
				await Executor.write(terminal.component.pid, command + '\r');
			} catch (error) {
				// Fallback to terminal write
				acode.require('terminal').write(terminal.id, command + '\r');
			}
		}
	}

	/**
	 * Check if a command exists in the system
	 */
	async #checkCommandExists(commandConfig) {
		try {
			// Extract the main command (first word) from the command string
			const mainCommand = commandConfig.cmd.split(' ')[0];
			
			// Use 'which' command to check if it exists
			const result = await Executor.execute(`which ${mainCommand}`, true);
			return result && result.trim() !== '';
		} catch (error) {
			// Command doesn't exist
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
		const packages = commandConfig.packages.filter(pkg => pkg); // Remove empty packages

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
			// Update package lists first
			await Executor.execute('apk update', true);

			// Install packages in background
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
		// Clear runners
		this.#runners.clear();
	}
}