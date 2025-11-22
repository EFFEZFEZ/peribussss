/**
 * tripScheduler.js
 * * * CORRIGÉ (V15 - Logique Stricte)
 * * Basé sur la clarification: le bus ne doit exister
 * * que du DÉPART du premier arrêt à l'ARRIVÉE du dernier arrêt.
 * *
 * * - SUPPRESSION de l'état "waiting_at_stop".
 * *
 * * Le bus n'apparaît plus avant son heure de départ
 * * et disparaît après son heure d'arrivée.
 */

export class TripScheduler {
    constructor(dataManager) {
        this.dataManager = dataManager;
    }

    /**
     * Récupère tous les trips "en service" (en mouvement OU en attente au terminus)
     */
    getActiveTrips(currentSeconds, date) {
        if (!this.dataManager.isLoaded) {
            return [];
        }

        const activeTrips = this.dataManager.getActiveTrips(currentSeconds, date);
        const activeBuses = [];

        activeTrips.forEach(({ tripId, trip, stopTimes, route }) => {
            const state = this.findCurrentState(stopTimes, currentSeconds); 
            
            if (state) {
                // state est toujours de type 'moving'
                activeBuses.push({
                    tripId,
                    trip,
                    route,
                    segment: state, // 'state' est 'moving'
                    position: null, // 'position' n'est jamais utilisé
                    currentSeconds
                });
            }
        });

        return activeBuses;
    }


    /**
     * CORRIGÉ (Logique V15): "Logique Stricte"
     */
    findCurrentState(stopTimes, currentSeconds) {
        if (!stopTimes || stopTimes.length < 2) {
            return null;
        }

        // *** CORRECTION V15 ***
        // Le bloc "Cas 1: En attente au premier arrêt" a été supprimé.
        // Le bus n'existera pas avant 'firstDepartureTime'.
        
        // Cas 2: En mouvement (Logique V12)
        // La boucle 'for' gère implicitement le premier segment
        // (stopTimes[0].departureTime à stopTimes[1].departureTime)
        for (let i = 1; i < stopTimes.length; i++) {
            const currentStop = stopTimes[i];
            const prevStop = stopTimes[i - 1];

            // *** NOUVELLE LOGIQUE V12 ***
            // Le segment de mouvement dure du DÉPART de A jusqu'au DÉPART de B.
            
            const prevDepartureTime = this.dataManager.timeToSeconds(prevStop.departure_time);
            const currentDepartureTime = this.dataManager.timeToSeconds(currentStop.departure_time);
            
            // Si l'heure est EXACTEMENT l'heure de départ, il passe au segment suivant.
            if (currentSeconds >= prevDepartureTime && currentSeconds < currentDepartureTime) {
                
                const prevStopInfo = this.dataManager.getStop(prevStop.stop_id);
                const currentStopInfo = this.dataManager.getStop(currentStop.stop_id);
                if (!prevStopInfo || !currentStopInfo) return null;

                return {
                    type: 'moving',
                    fromStopInfo: prevStopInfo,
                    toStopInfo: currentStopInfo,
                    departureTime: prevDepartureTime,      // Heure de début (Départ A)
                    arrivalTime: currentDepartureTime,      // Heure de fin (Départ B)
                    progress: this.calculateProgress(prevDepartureTime, currentDepartureTime, currentSeconds)
                };
            }
            
            // Cas V7 (Priorité 2: Attente) a été supprimé.
        }
        
        // Gérer le dernier segment (Arrivée au terminus final)
        const lastStop = stopTimes[stopTimes.length - 1];
        const prevStop = stopTimes[stopTimes.length - 2];
        const prevDepartureTime = this.dataManager.timeToSeconds(prevStop.departure_time);
        const lastArrivalTime = this.dataManager.timeToSeconds(lastStop.arrival_time);

        if (currentSeconds >= prevDepartureTime && currentSeconds <= lastArrivalTime) {
             const prevStopInfo = this.dataManager.getStop(prevStop.stop_id);
             const lastStopInfo = this.dataManager.getStop(lastStop.stop_id);
             if (!prevStopInfo || !lastStopInfo) return null;
             
             return {
                 type: 'moving',
                 fromStopInfo: prevStopInfo,
                 toStopInfo: lastStopInfo,
                 departureTime: prevDepartureTime,
                 arrivalTime: lastArrivalTime,
                 progress: this.calculateProgress(prevDepartureTime, lastArrivalTime, currentSeconds)
             };
        }
        
        // Si currentSeconds est avant le premier départ
        // ou après la dernière arrivée, on retourne null.
        return null; 
    }

    /**
     * Calcule la progression entre deux arrêts (0 à 1)
     */
    calculateProgress(departureTime, arrivalTime, currentTime) {
        const totalDuration = arrivalTime - departureTime;
        if (totalDuration <= 0) return 0; // Évite la division par zéro

        const elapsed = currentTime - departureTime;
        return Math.max(0, Math.min(1, elapsed / totalDuration));
    }

    /**
     * Estime le temps d'arrivée au prochain arrêt
     */
    getNextStopETA(segment, currentSeconds) {
        if (!segment) return null;

        // "arrivalTime" (dans V12) est l'heure de départ de l'arrêt suivant
        // Ce calcul reste donc correct pour l'ETA
        const remainingSeconds = segment.arrivalTime - currentSeconds;
        const minutes = Math.max(0, Math.floor(remainingSeconds / 60));
        const seconds = Math.max(0, Math.floor(remainingSeconds % 60));
        
        // *** CORRECTION V15 ***
        // Gère le cas où le bus est arrivé au terminus (progress 1)
        // (Concerne le 'dernier segment' de findCurrentState)
         if (segment.progress === 1) {
            return {
                seconds: 0,
                formatted: "Terminus"
            };
        }

        return {
            seconds: remainingSeconds,
            formatted: `${minutes}m ${seconds}s`
        };
    }

    /**
     * Récupère la destination finale d'un trip
     */
    getTripDestination(stopTimes) {
        if (!stopTimes || stopTimes.length === 0) {
            return 'Destination inconnue';
        }

        const lastStop = stopTimes[stopTimes.length - 1];
        const stopInfo = this.dataManager.getStop(lastStop.stop_id);
        
        return stopInfo ? stopInfo.stop_name : lastStop.stop_id;
    }
}
