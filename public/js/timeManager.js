/**
 * timeManager.js
 * * Gère le temps réel ou simulé pour l'affichage des bus en circulation
 */

export class TimeManager {
    constructor() {
        this.isRunning = false;
        this.listeners = [];
        this.mode = 'real';
        this.simulatedSeconds = null;
        this.lastTickTime = null;
        
        /* AJOUT: Stocke la date actuelle pour la logique du calendrier */
        this.currentDate = new Date(); 
    }

    /**
     * Récupère l'heure réelle actuelle
     */
    getRealTime() {
        /* MODIFICATION: Met à jour la date en même temps */
        this.currentDate = new Date();
        const now = this.currentDate;
        
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        
        return hours * 3600 + minutes * 60 + seconds;
    }

    /**
     * Définit le mode (real ou simulated)
     */
    setMode(mode) {
        if (mode !== 'real' && mode !== 'simulated') {
            console.error('Mode invalide. Utilisez "real" ou "simulated"');
            return;
        }
        this.mode = mode;
        console.log(`🔧 Mode changé: ${mode}`);
        
        // S'assure que la date est celle d'aujourd'hui, même en simulation
        this.currentDate = new Date(); 
        
        this.notifyListeners();
    }

    /**
     * Définit l'heure simulée
     */
    setTime(seconds) {
        this.simulatedSeconds = seconds;
        this.lastTickTime = Date.now();
        
        // En mode simulation, on utilise TOUJOURS la date d'aujourd'hui
        this.currentDate = new Date(); 
        
        console.log(`⏰ Heure simulée définie: ${this.formatTime(seconds)}`);
        this.notifyListeners();
    }

    /**
     * Démarre la simulation ou le temps réel
     */
    play() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.lastTickTime = Date.now();
            // S'assure que la date est à jour au démarrage
            this.currentDate = new Date(); 
            this.tick();
            console.log(`▶️ Mode ${this.mode === 'simulated' ? 'simulation' : 'temps réel'} démarré`);
        }
    }

    /**
     * Met en pause la mise à jour
     */
    pause() {
        this.isRunning = false;
        console.log('⏸️ Pause');
    }

    /**
     * Redémarre le temps
     */
    reset() {
        console.log('🔄 Rechargement');
        this.lastTickTime = Date.now();
        this.currentDate = new Date(); // Réinitialise la date
        this.notifyListeners();
    }

    /**
     * Boucle principale de mise à jour
     */
    tick() {
        if (!this.isRunning) return;

        const now = Date.now();
        if (this.mode === 'simulated' && this.simulatedSeconds !== null && this.lastTickTime !== null) {
            const elapsed = (now - this.lastTickTime) / 1000;
            this.simulatedSeconds += elapsed;
            
            if (this.simulatedSeconds >= 86400) {
                this.simulatedSeconds = 0;
            }
            // En simulation, la date est fixée (celle d'aujourd'hui)
            // On ne met PAS à jour this.currentDate ici
            
        } else {
            // En mode réel, on met à jour la date à chaque tick
            this.currentDate = new Date();
        }
        
        this.lastTickTime = now;

        this.notifyListeners();

        setTimeout(() => this.tick(), 1000);
    }

    /**
     * Ajoute un listener pour les changements de temps
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Notifie tous les listeners
     */
    notifyListeners() {
        const currentSeconds = this.getCurrentSeconds();
        
        // En mode réel, la date est mise à jour dans getRealTime() ou tick()
        // En mode simulé, la date est celle d'aujourd'hui (fixée dans setMode/setTime/play)
        
        const timeInfo = {
            seconds: currentSeconds,
            timeString: this.formatTime(currentSeconds),
            isRunning: this.isRunning,
            mode: this.mode,
            date: this.currentDate // Utilise la date stockée
        };

        this.listeners.forEach(callback => {
            callback(timeInfo);
        });
    }

    /**
     * Formate les secondes en HH:MM:SS
     */
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600) % 24;
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    /**
     * Récupère le temps actuel en secondes
     */
    getCurrentSeconds() {
        if (this.mode === 'simulated' && this.simulatedSeconds !== null) {
            return this.simulatedSeconds;
        }
        return this.getRealTime();
    }

    /* NOUVELLE FONCTION */
    /**
     * Récupère la date actuelle (réelle ou de simulation)
     */
    getCurrentDate() {
        // Si le timeManager n'est pas en cours, s'assurer que la date est fraîche
        if (!this.isRunning && this.mode === 'real') {
            this.currentDate = new Date();
        }
        // En mode simulation, la date est déjà celle d'aujourd'hui
        return this.currentDate;
    }

    /**
     * Récupère le temps actuel en format HH:MM:SS
     */
    getCurrentTimeString() {
        return this.formatTime(this.getCurrentSeconds());
    }

    /**
     * Vérifie si le gestionnaire est en cours d'exécution
     */
    getIsRunning() {
        return this.isRunning;
    }

    /**
     * Vérifie si le mode est simulé
     */
    getIsSimulated() {
        return this.mode === 'simulated';
    }
}
